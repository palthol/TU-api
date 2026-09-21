-- Complete V1 monthly subscription charge generation.
--
-- This migration is intentionally not applied to production by this change.
-- Before applying it, operators must verify that the unique-index preflight
-- query documented in docs/deployment.md returns no duplicate rows.

create unique index if not exists uq_charges_subscription_coverage_nonvoid
  on public.charges (subscription_id, coverage_start)
  where subscription_id is not null and status <> 'void';

-- The dated implementation is private so database tests can prove future
-- periods without changing the server clock. The public, service-role-only RPC
-- retains its existing zero-argument contract.
create or replace function private.generate_monthly_charges_as_of(p_as_of date)
returns table (
  charge_id uuid,
  account_id uuid,
  subscription_id uuid,
  amount_cents integer,
  coverage_start date,
  coverage_end date,
  due_at date
)
language plpgsql
set search_path = public, private
as $$
declare
  sub_record record;
  charge_record record;
  next_coverage_start date;
  next_coverage_end date;
begin
  if p_as_of is null then
    raise exception 'as_of date is required';
  end if;

  -- Serialize generator executions. The unique partial index remains the
  -- authoritative invariant for any charge inserted outside this function.
  perform pg_advisory_xact_lock(hashtextextended('public.generate_monthly_charges', 0));

  for sub_record in
    select
      s.id as subscription_id,
      s.account_id,
      s.starts_at,
      s.ends_at,
      pd.price_cents,
      pd.currency,
      pd.name as plan_name,
      (
        select max(ch.coverage_end)
        from public.charges ch
        where ch.subscription_id = s.id
          and ch.status <> 'void'
      ) as last_coverage_end
    from public.subscriptions s
    join public.plan_definitions pd on pd.id = s.plan_definition_id
    where s.status = 'active'
      and pd.billing_cadence = 'monthly'
      and pd.price_cents > 0
      and s.starts_at <= p_as_of
      and (s.ends_at is null or s.ends_at >= p_as_of)
  loop
    -- Never manufacture historical debt. If enrollment predates automation or
    -- there is a gap after the last real charge, establish a current-period
    -- baseline at p_as_of instead of replaying old months.
    next_coverage_start := greatest(
      sub_record.starts_at,
      coalesce(sub_record.last_coverage_end + 1, sub_record.starts_at),
      p_as_of
    );

    if next_coverage_start > p_as_of then
      continue;
    end if;

    if sub_record.ends_at is not null and next_coverage_start > sub_record.ends_at then
      continue;
    end if;

    next_coverage_end := (
      date_trunc('month', next_coverage_start::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;

    if sub_record.ends_at is not null and sub_record.ends_at < next_coverage_end then
      next_coverage_end := sub_record.ends_at;
    end if;

    insert into public.charges as inserted_charge (
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
      sub_record.account_id,
      sub_record.subscription_id,
      sub_record.price_cents,
      coalesce(sub_record.currency, 'USD'),
      next_coverage_start,
      next_coverage_end,
      next_coverage_start,
      'open',
      format(
        'Auto-generated for subscription period %s to %s',
        next_coverage_start,
        next_coverage_end
      )
    )
    on conflict (subscription_id, coverage_start)
      where subscription_id is not null and status <> 'void'
      do nothing
    returning
      inserted_charge.id,
      inserted_charge.account_id,
      inserted_charge.subscription_id,
      inserted_charge.amount_cents,
      inserted_charge.coverage_start,
      inserted_charge.coverage_end,
      inserted_charge.due_at
    into charge_record;

    if found then
      charge_id := charge_record.id;
      account_id := charge_record.account_id;
      subscription_id := charge_record.subscription_id;
      amount_cents := charge_record.amount_cents;
      coverage_start := charge_record.coverage_start;
      coverage_end := charge_record.coverage_end;
      due_at := charge_record.due_at;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.generate_monthly_charges()
returns table (
  charge_id uuid,
  account_id uuid,
  subscription_id uuid,
  amount_cents integer,
  coverage_start date,
  coverage_end date,
  due_at date
)
language sql
volatile
set search_path = public, private
as $$
  select * from private.generate_monthly_charges_as_of(current_date);
$$;

comment on function public.generate_monthly_charges() is
  'Creates at most one currently due charge per active paid monthly subscription without historical backfill.';

revoke all on function private.generate_monthly_charges_as_of(date) from public;
revoke all on function private.generate_monthly_charges_as_of(date) from anon;
revoke all on function private.generate_monthly_charges_as_of(date) from authenticated;
revoke all on function public.generate_monthly_charges() from public;
revoke all on function public.generate_monthly_charges() from anon;
revoke all on function public.generate_monthly_charges() from authenticated;
grant execute on function private.generate_monthly_charges_as_of(date) to service_role;
grant execute on function public.generate_monthly_charges() to service_role;

-- Preserve create_subscription's established signature while preventing
-- monetary charge rows for free monthly plans.
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
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_subscription_id;

  if coalesce(p_create_initial_charge, false)
    and v_plan.billing_cadence = 'monthly'
    and v_plan.price_cents > 0
  then
    v_coverage_end := (
      date_trunc('month', v_coverage_start::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;
    if p_ends_at is not null and p_ends_at < v_coverage_end then
      v_coverage_end := p_ends_at;
    end if;

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
      v_coverage_start,
      'open',
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
      where subscription_id is not null and status <> 'void'
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
    'initial_charge_id', v_initial_charge_id
  );
end;
$$;

comment on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) is
  'Creates an active subscription and optionally one initial charge for a paid monthly plan; free plans never create monetary charge rows.';

revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from public;
revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from anon;
revoke all on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) from authenticated;
grant execute on function public.create_subscription(uuid, uuid, date, date, uuid, boolean, text, text) to service_role;
