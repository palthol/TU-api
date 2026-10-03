-- Corrective migration: preserve legacy enrollment contract and initial-charge logic.
-- Serialize legacy/covered RPCs; no financial or subscription backfill.
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
  v_initial_coverage_start date;
  v_coverage_end date;
  v_automatic_billing_starts_at date;
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
  where p.id = p_participant_id for update;
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

  if v_plan.billing_cadence = 'monthly' and v_plan.price_cents > 0 then
    v_initial_coverage_start := greatest(v_coverage_start, current_date);
    if p_ends_at is null or p_ends_at >= v_initial_coverage_start then
      v_coverage_end := (
        date_trunc('month', v_initial_coverage_start::timestamp)
        + interval '1 month'
        - interval '1 day'
      )::date;
      if p_ends_at is not null and p_ends_at < v_coverage_end then
        v_coverage_end := p_ends_at;
      end if;
      v_automatic_billing_starts_at := v_coverage_end + 1;
    end if;
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

  -- Share the participant mutex with enroll_obligation_entitlement. The overlap
  -- check runs after acquiring it, so a competing RPC sees the committed winner.
  -- Inclusive ends_at means adjacent access starts on the following day.
  if exists (
    select 1 from public.subscriptions s
    where s.participant_id = p_participant_id and s.status = 'active'
      and daterange(s.starts_at, s.ends_at, '[]')
          && daterange(v_coverage_start, p_ends_at, '[]')
  ) then
    raise exception 'overlapping_active_subscription';
  end if;

  insert into public.subscriptions (
    account_id,
    participant_id,
    plan_definition_id,
    status,
    starts_at,
    ends_at,
    automatic_billing_starts_at,
    notes
  )
  values (
    v_account_id,
    p_participant_id,
    p_plan_definition_id,
    'active',
    v_coverage_start,
    p_ends_at,
    v_automatic_billing_starts_at,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_subscription_id;

  if coalesce(p_create_initial_charge, false)
    and v_plan.billing_cadence = 'monthly'
    and v_plan.price_cents > 0
    and v_automatic_billing_starts_at is not null
  then
    insert into public.charges (
      account_id,
      subscription_id,
      amount_cents,
      currency,
      coverage_start,
      coverage_end,
      due_at,
      status,
      charge_kind,
      notes
    )
    values (
      v_account_id,
      v_subscription_id,
      v_plan.price_cents,
      coalesce(v_plan.currency, 'USD'),
      v_initial_coverage_start,
      v_coverage_end,
      v_initial_coverage_start,
      'open',
      'monthly_period',
      concat_ws(
        ' | ',
        format('Initial monthly charge for plan %s', v_plan.name),
        case
          when p_created_by is not null and btrim(p_created_by) <> ''
            then 'created_by=' || btrim(p_created_by)
          else null
        end
      )
    )
    on conflict (subscription_id, coverage_start)
      where subscription_id is not null
        and status <> 'void'
        and charge_kind = 'monthly_period'
      do nothing
    returning id into v_initial_charge_id;
  elsif coalesce(p_create_initial_charge, false)
    and v_plan.billing_cadence <> 'monthly'
  then
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
    'initial_charge_id', v_initial_charge_id,
    'automatic_billing_starts_at', v_automatic_billing_starts_at
  );
end;
$$;


comment on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) is
  'Creates an active subscription with a safe recurring-billing baseline and optionally one current-period monthly_period charge for a paid monthly plan.';

revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from public;
revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from anon;
revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from authenticated;
grant execute on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) to service_role;
