-- Tier 1 infrastructure: subscription enrollment RPC and session cancellation marker.

-- -----------------------------------------------------------------------------
-- sessions.cancelled_at — soft-cancel without deleting attendance history
-- -----------------------------------------------------------------------------
alter table public.sessions
  add column if not exists cancelled_at timestamptz;

comment on column public.sessions.cancelled_at is
  'When set, session is cancelled; attendance rows are retained for history.';

-- Exclude cancelled sessions from day-of ops board
create or replace view public.view_ops_today_sessions
with (security_invoker = on) as
with session_attendance as (
  select
    s.id as session_id,
    count(ar.id)::integer as tracked_attendee_count,
    count(*) filter (where ar.status = 'present')::integer as present_count,
    count(*) filter (where ar.status = 'no_show')::integer as no_show_count,
    count(*) filter (where ar.status = 'cancelled')::integer as cancelled_count
  from public.sessions s
  left join public.attendance_records ar on ar.session_id = s.id
  where s.starts_at::date = current_date
    and s.cancelled_at is null
  group by s.id
)
select
  s.id as session_id,
  s.starts_at,
  s.ends_at,
  s.session_label,
  s.schedule_template_id,
  coalesce(sa.tracked_attendee_count, 0) as tracked_attendee_count,
  coalesce(sa.present_count, 0) as present_count,
  coalesce(sa.no_show_count, 0) as no_show_count,
  coalesce(sa.cancelled_count, 0) as cancelled_count,
  case
    when coalesce(sa.tracked_attendee_count, 0) = 0 then 0::numeric(6,2)
    else round((coalesce(sa.present_count, 0)::numeric * 100.0) / sa.tracked_attendee_count::numeric, 2)
  end as filled_percent
from public.sessions s
left join session_attendance sa on sa.session_id = s.id
where s.starts_at::date = current_date
  and s.cancelled_at is null
order by s.starts_at asc, s.id asc;

comment on view public.view_ops_today_sessions is
  'Day-of logistics board: session counts by attendance status and present-share percent (excludes cancelled sessions).';

-- -----------------------------------------------------------------------------
-- create_subscription — enroll participant on plan; optional first monthly charge
-- -----------------------------------------------------------------------------
create or replace function public.create_subscription(
  p_participant_id uuid,
  p_plan_definition_id uuid,
  p_starts_at date default current_date,
  p_ends_at date default null,
  p_account_id uuid default null,
  p_create_initial_charge boolean default false,
  p_notes text default null,
  p_created_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant record;
  v_plan record;
  v_account_id uuid;
  v_subscription_id uuid;
  v_initial_charge_id uuid;
  v_coverage_start date;
  v_coverage_end date;
  v_due_at date;
begin
  if p_participant_id is null then
    raise exception 'participant id is required';
  end if;
  if p_plan_definition_id is null then
    raise exception 'plan definition id is required';
  end if;

  v_coverage_start := coalesce(p_starts_at, current_date);

  if p_ends_at is not null and p_ends_at < v_coverage_start then
    raise exception 'ends_at must be on or after starts_at';
  end if;

  select p.id into v_participant
  from public.participants p
  where p.id = p_participant_id;

  if v_participant.id is null then
    raise exception 'Participant not found: %', p_participant_id;
  end if;

  select
    pd.id,
    pd.price_cents,
    pd.currency,
    pd.billing_cadence,
    pd.is_active,
    pd.name
  into v_plan
  from public.plan_definitions pd
  where pd.id = p_plan_definition_id;

  if v_plan.id is null then
    raise exception 'Plan not found: %', p_plan_definition_id;
  end if;

  if not v_plan.is_active then
    raise exception 'Plan is not active: %', p_plan_definition_id;
  end if;

  v_account_id := p_account_id;

  if v_account_id is null then
    select am.account_id into v_account_id
    from public.account_members am
    where am.participant_id = p_participant_id
    order by am.created_at asc
    limit 1;
  end if;

  if v_account_id is null then
    raise exception 'No account for participant %; provide account_id or bind account first', p_participant_id;
  end if;

  if not exists (
    select 1 from public.accounts a where a.id = v_account_id and a.status = 'active'
  ) then
    raise exception 'Account not found or not active: %', v_account_id;
  end if;

  if not exists (
    select 1
    from public.account_members am
    where am.account_id = v_account_id
      and am.participant_id = p_participant_id
  ) then
    raise exception 'Participant % is not a member of account %', p_participant_id, v_account_id;
  end if;

  insert into public.subscriptions (
    account_id,
    participant_id,
    plan_definition_id,
    status,
    starts_at,
    ends_at,
    notes
  )
  values (
    v_account_id,
    p_participant_id,
    p_plan_definition_id,
    'active',
    v_coverage_start,
    p_ends_at,
    case
      when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes)
      else null
    end
  )
  returning id into v_subscription_id;

  if coalesce(p_create_initial_charge, false) and v_plan.billing_cadence = 'monthly' then
    v_coverage_end := (
      date_trunc('month', v_coverage_start::timestamp) + interval '1 month' - interval '1 day'
    )::date;

    if p_ends_at is not null and p_ends_at < v_coverage_end then
      v_coverage_end := p_ends_at;
    end if;

    v_due_at := v_coverage_start;

    if not exists (
      select 1
      from public.charges ch
      where ch.subscription_id = v_subscription_id
        and ch.coverage_start = v_coverage_start
        and ch.status <> 'void'
    ) then
      insert into public.charges (
        account_id,
        subscription_id,
        amount_cents,
        currency,
        coverage_start,
        coverage_end,
        due_at,
        status,
        notes
      )
      values (
        v_account_id,
        v_subscription_id,
        v_plan.price_cents,
        coalesce(v_plan.currency, 'USD'),
        v_coverage_start,
        v_coverage_end,
        v_due_at,
        'open',
        concat_ws(
          ' | ',
          format('Initial monthly charge for plan %s', v_plan.name),
          case when p_created_by is not null and btrim(p_created_by) <> '' then 'created_by=' || btrim(p_created_by) else null end
        )
      )
      returning id into v_initial_charge_id;
    end if;
  elsif coalesce(p_create_initial_charge, false) and v_plan.billing_cadence <> 'monthly' then
    raise exception
      'create_initial_charge only applies to monthly plans (plan % has cadence %)',
      p_plan_definition_id,
      v_plan.billing_cadence;
  end if;

  return jsonb_build_object(
    'subscription_id', v_subscription_id,
    'account_id', v_account_id,
    'participant_id', p_participant_id,
    'plan_definition_id', p_plan_definition_id,
    'initial_charge_id', v_initial_charge_id
  );
end;
$$;

comment on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) is
  'Creates an active subscription for a participant on a plan. Optionally creates the first monthly charge.';

revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from public;
revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from anon;
revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from authenticated;
grant execute on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) to service_role;
