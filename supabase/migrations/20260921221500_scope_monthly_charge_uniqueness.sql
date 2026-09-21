-- Scope monthly charge uniqueness and anchor per-class conversions.
--
-- Migration 20260921185003 is not applied to production. It installs a unique
-- index on every non-void (subscription_id, coverage_start). That is broader
-- than recurring monthly generation: it rejects a second same-day per-class
-- charge and a prorated upgrade whose effective date matches an existing
-- coverage start. This migration replaces that index with one that covers only
-- monthly-period charges, and it persists automatic_billing_starts_at when a
-- per-session subscription converts to a paid monthly plan.
--
-- Do not apply this file to production from an agent run. Apply it in the same
-- reviewed migration push as 20260921185003, before enabling the daily billing
-- cron and before recording per-class or proration charges.

alter table public.charges
  add column if not exists charge_kind text not null default 'manual';

comment on column public.charges.charge_kind is
  'Why the charge exists. monthly_period is the only kind covered by the recurring coverage unique index. per_class and proration may share a subscription coverage start. manual is the default for direct inserts.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'check_charge_kind'
      and conrelid = 'public.charges'::regclass
  ) then
    alter table public.charges
      add constraint check_charge_kind
      check (charge_kind in ('monthly_period', 'per_class', 'proration', 'manual'));
  end if;
end $$;

-- Classify rows already written by the billing RPCs. Keep at most one
-- non-void monthly_period row per subscription coverage start so the
-- replacement unique index can be created on databases that already applied
-- 20260921185003. Unclassified duplicates stay manual for operator review.
update public.charges
set charge_kind = 'per_class'
where charge_kind = 'manual'
  and notes like 'Pay-per-class charge from attendance %';

update public.charges
set charge_kind = 'proration'
where charge_kind = 'manual'
  and notes like 'Prorated plan upgrade (%';

update public.charges
set charge_kind = 'monthly_period'
where id in (
  select distinct on (subscription_id, coverage_start) id
  from public.charges
  where subscription_id is not null
    and status <> 'void'
    and charge_kind = 'manual'
    and (
      notes like 'Auto-generated for subscription period %'
      or notes like 'Initial monthly charge for plan %'
      or notes like 'Initial monthly charge from per-session conversion (%'
    )
  order by subscription_id, coverage_start, created_at asc, id asc
);

drop index if exists public.uq_charges_subscription_coverage_nonvoid;

create unique index if not exists uq_charges_monthly_period_coverage_nonvoid
  on public.charges (subscription_id, coverage_start)
  where subscription_id is not null
    and status <> 'void'
    and charge_kind = 'monthly_period';

comment on index public.uq_charges_monthly_period_coverage_nonvoid is
  'One non-void monthly-period charge per subscription coverage start. Per-class, proration, and manual charges are outside this invariant.';

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
#variable_conflict use_column
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
      s.automatic_billing_starts_at,
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
      and s.automatic_billing_starts_at is not null
      and s.starts_at <= p_as_of
      and (s.ends_at is null or s.ends_at >= p_as_of)
  loop
    -- Never manufacture historical debt. If enrollment predates automation or
    -- there is a gap after the last real charge, establish a current-period
    -- baseline at p_as_of instead of replaying old months.
    next_coverage_start := greatest(
      sub_record.automatic_billing_starts_at,
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
      charge_kind,
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
      'monthly_period',
      format(
        'Auto-generated for subscription period %s to %s',
        next_coverage_start,
        next_coverage_end
      )
    )
    on conflict (subscription_id, coverage_start)
      where subscription_id is not null
        and status <> 'void'
        and charge_kind = 'monthly_period'
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

create or replace function public.create_pay_per_class_charge(
  p_attendance_id uuid,
  p_due_at date default null,
  p_notes text default null,
  p_created_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance record;
  v_existing_charge_id uuid;
  v_subscription record;
  v_charge_id uuid;
  v_service_date date;
begin
  if p_attendance_id is null then
    raise exception 'attendance id is required';
  end if;

  select
    ar.id,
    ar.participant_id,
    ar.status,
    ar.session_id,
    s.starts_at::date as session_date,
    s.session_label
  into v_attendance
  from public.attendance_records ar
  join public.sessions s on s.id = ar.session_id
  where ar.id = p_attendance_id;

  if v_attendance.id is null then
    raise exception 'Attendance record not found: %', p_attendance_id;
  end if;

  if v_attendance.status <> 'present' then
    raise exception 'Only attendance status=present can be charged (got %)', v_attendance.status;
  end if;

  -- Idempotency: return existing linked charge if this attendance was already charged.
  select ccl.charge_id into v_existing_charge_id
  from public.class_charge_links ccl
  where ccl.attendance_record_id = p_attendance_id;

  if v_existing_charge_id is not null then
    return v_existing_charge_id;
  end if;

  v_service_date := coalesce(v_attendance.session_date, current_date);

  select
    s.id,
    s.account_id,
    s.participant_id,
    s.plan_definition_id,
    pd.price_cents,
    pd.currency,
    pd.name as plan_name
  into v_subscription
  from public.subscriptions s
  join public.plan_definitions pd on pd.id = s.plan_definition_id
  where s.participant_id = v_attendance.participant_id
    and s.status = 'active'
    and pd.billing_cadence = 'per_session'
    and s.starts_at <= v_service_date
    and (s.ends_at is null or s.ends_at >= v_service_date)
  order by s.starts_at desc, s.created_at desc
  limit 1;

  if v_subscription.id is null then
    raise exception
      'No active per-session subscription found for participant % on %',
      v_attendance.participant_id,
      v_service_date;
  end if;

  if exists (
    select 1
    from public.subscriptions s2
    join public.plan_definitions pd2 on pd2.id = s2.plan_definition_id
    where s2.participant_id = v_attendance.participant_id
      and s2.status = 'active'
      and pd2.billing_cadence = 'per_session'
      and s2.starts_at <= v_service_date
      and (s2.ends_at is null or s2.ends_at >= v_service_date)
      and s2.id <> v_subscription.id
  ) then
    raise exception
      'Multiple active per-session subscriptions found for participant % on %',
      v_attendance.participant_id,
      v_service_date;
  end if;

  if v_subscription.account_id is null then
    raise exception 'Per-session subscription % has no account_id', v_subscription.id;
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
    charge_kind,
    notes
  )
  values (
    v_subscription.account_id,
    v_subscription.id,
    v_subscription.price_cents,
    coalesce(v_subscription.currency, 'USD'),
    v_service_date,
    v_service_date,
    coalesce(p_due_at, v_service_date),
    'open',
    'per_class',
    concat_ws(
      ' | ',
      format('Pay-per-class charge from attendance %s (session %s)', p_attendance_id, v_attendance.session_id),
      case when v_attendance.session_label is not null and btrim(v_attendance.session_label) <> '' then format('label=%s', v_attendance.session_label) else null end,
      case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
    )
  )
  returning id into v_charge_id;

  insert into public.class_charge_links (
    attendance_record_id,
    charge_id,
    created_by
  )
  values (
    p_attendance_id,
    v_charge_id,
    nullif(btrim(coalesce(p_created_by, '')), '')
  );

  return v_charge_id;
end;
$$;


comment on function public.create_pay_per_class_charge(uuid, date, text, text) is
  'Creates one per-session charge from one present attendance record. Idempotent via class_charge_links. Same-day classes are separate charges.';

revoke all on function public.create_pay_per_class_charge(uuid, date, text, text) from public;
revoke all on function public.create_pay_per_class_charge(uuid, date, text, text) from anon;
revoke all on function public.create_pay_per_class_charge(uuid, date, text, text) from authenticated;
grant execute on function public.create_pay_per_class_charge(uuid, date, text, text) to service_role;

create or replace function public.upgrade_subscription_prorated(
  p_subscription_id uuid,
  p_new_plan_definition_id uuid,
  p_effective_date date default (current_date)
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_old_price integer;
  v_new_price integer;
  v_period_start date;
  v_period_end date;
  v_days_total integer;
  v_days_remain integer;
  v_delta integer;
  v_charge_id uuid;
  v_eff date;
begin
  v_eff := coalesce(p_effective_date, (current_date));

  select
    s.id,
    s.account_id,
    s.participant_id,
    s.plan_definition_id,
    s.starts_at,
    s.ends_at,
    s.status
  into v_sub
  from public.subscriptions s
  where s.id = p_subscription_id;

  if v_sub.id is null then
    raise exception 'Subscription not found';
  end if;
  if v_sub.status <> 'active' then
    raise exception 'Only active subscriptions can be upgraded';
  end if;
  if v_sub.ends_at is not null and v_sub.ends_at < v_eff then
    raise exception 'Subscription has already ended before effective date';
  end if;

  select pd.price_cents into v_old_price
  from public.plan_definitions pd
  where pd.id = v_sub.plan_definition_id;

  select pd.price_cents into v_new_price
  from public.plan_definitions pd
  where pd.id = p_new_plan_definition_id;

  if v_new_price is null then
    raise exception 'New plan not found';
  end if;
  if v_new_price <= v_old_price then
    raise exception 'New plan price must be greater than current plan (upgrade only)';
  end if;

  select c.coverage_start, c.coverage_end
  into v_period_start, v_period_end
  from public.charges c
  where c.subscription_id = p_subscription_id
    and c.status <> 'void'
    and c.coverage_start <= v_eff
    and c.coverage_end >= v_eff
  order by c.coverage_end desc
  limit 1;

  if v_period_start is null then
    v_period_start := date_trunc('month', v_eff)::date;
    v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  end if;

  if v_eff > v_period_end then
    raise exception 'Effective date is after current billing period end';
  end if;

  v_days_total := (v_period_end - v_period_start + 1);
  v_days_remain := (v_period_end - v_eff + 1);

  if v_days_total <= 0 or v_days_remain <= 0 then
    raise exception 'Invalid billing period for proration';
  end if;

  v_delta := round((v_new_price - v_old_price)::numeric * v_days_remain::numeric / v_days_total::numeric)::integer;

  if v_delta <= 0 then
    raise exception 'Computed proration amount is not positive';
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
    charge_kind,
    notes
  )
  values (
    v_sub.account_id,
    p_subscription_id,
    v_delta,
    'USD',
    v_eff,
    v_period_end,
    v_eff,
    'open',
    'proration',
    format(
      'Prorated plan upgrade (%s days of %s in period %s–%s)',
      v_days_remain,
      v_days_total,
      v_period_start,
      v_period_end
    )
  )
  returning id into v_charge_id;

  update public.subscriptions
  set plan_definition_id = p_new_plan_definition_id,
      updated_at = now()
  where id = p_subscription_id;

  return v_charge_id;
end;
$$;

comment on function public.upgrade_subscription_prorated(uuid, uuid, date) is
  'Upgrades an active subscription and inserts a proration charge. The delta is not a monthly-period charge and may share the current coverage start.';

revoke all on function public.upgrade_subscription_prorated(uuid, uuid, date) from public;
revoke all on function public.upgrade_subscription_prorated(uuid, uuid, date) from anon;
revoke all on function public.upgrade_subscription_prorated(uuid, uuid, date) from authenticated;
grant execute on function public.upgrade_subscription_prorated(uuid, uuid, date) to service_role;

drop function if exists public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text);

create or replace function public.upgrade_per_class_to_monthly(
  p_participant_id uuid,
  p_new_plan_definition_id uuid,
  p_effective_date date default current_date,
  p_create_initial_charge boolean default true,
  p_notes text default null,
  p_conversion_policy text default 'no_credit'
)
returns table (
  old_subscription_id uuid,
  new_subscription_id uuid,
  initial_charge_id uuid,
  automatic_billing_starts_at date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_sub record;
  v_new_plan record;
  v_effective_date date;
  v_initial_charge_id uuid;
  v_coverage_end date;
  v_period_end date;
  v_automatic_billing_starts_at date;
  v_policy text;
begin
  if p_participant_id is null then
    raise exception 'participant id is required';
  end if;
  if p_new_plan_definition_id is null then
    raise exception 'new plan definition id is required';
  end if;

  v_effective_date := coalesce(p_effective_date, current_date);
  v_policy := lower(coalesce(nullif(btrim(p_conversion_policy), ''), 'no_credit'));

  if v_policy not in ('no_credit', 'manual_writeoff_allowed') then
    raise exception
      'Unsupported conversion policy: % (allowed: no_credit, manual_writeoff_allowed)',
      v_policy;
  end if;

  select
    pd.id,
    pd.price_cents,
    pd.currency,
    pd.billing_cadence,
    pd.name
  into v_new_plan
  from public.plan_definitions pd
  where pd.id = p_new_plan_definition_id;

  if v_new_plan.id is null then
    raise exception 'New plan not found: %', p_new_plan_definition_id;
  end if;
  if v_new_plan.billing_cadence <> 'monthly' then
    raise exception 'Target plan must be monthly (got %)', v_new_plan.billing_cadence;
  end if;

  select
    s.id,
    s.account_id,
    s.plan_definition_id,
    s.starts_at,
    s.ends_at
  into v_old_sub
  from public.subscriptions s
  join public.plan_definitions pd on pd.id = s.plan_definition_id
  where s.participant_id = p_participant_id
    and s.status = 'active'
    and pd.billing_cadence = 'per_session'
    and s.starts_at <= v_effective_date
    and (s.ends_at is null or s.ends_at >= v_effective_date)
  order by s.starts_at desc, s.created_at desc
  limit 1;

  if v_old_sub.id is null then
    raise exception
      'No active per-session subscription found for participant % on %',
      p_participant_id,
      v_effective_date;
  end if;

  if exists (
    select 1
    from public.subscriptions s
    join public.plan_definitions pd on pd.id = s.plan_definition_id
    where s.participant_id = p_participant_id
      and s.status = 'active'
      and pd.billing_cadence = 'monthly'
      and s.starts_at <= v_effective_date
      and (s.ends_at is null or s.ends_at >= v_effective_date)
  ) then
    raise exception
      'Participant % already has an active monthly subscription for %',
      p_participant_id,
      v_effective_date;
  end if;

  -- End old per-session subscription as of effective date.
  update public.subscriptions s
  set
    status = 'cancelled',
    ends_at = least(coalesce(s.ends_at, v_effective_date), v_effective_date),
    cancelled_at = now(),
    updated_at = now(),
    notes = concat_ws(
      ' | ',
      s.notes,
      format(
        'Converted to monthly plan %s effective %s (policy=%s)',
        p_new_plan_definition_id,
        v_effective_date,
        v_policy
      ),
      case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
    )
  where s.id = v_old_sub.id;

  v_coverage_end := (date_trunc('month', v_effective_date) + interval '1 month - 1 day')::date;
  v_period_end := greatest(v_effective_date, v_coverage_end);
  if coalesce(v_new_plan.price_cents, 0) > 0 then
    v_automatic_billing_starts_at := v_period_end + 1;
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
    v_old_sub.account_id,
    p_participant_id,
    p_new_plan_definition_id,
    'active',
    v_effective_date,
    null,
    v_automatic_billing_starts_at,
    concat_ws(
      ' | ',
      format(
        'Converted from per-session subscription %s (policy=%s)',
        v_old_sub.id,
        v_policy
      ),
      case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
    )
  )
  returning id into new_subscription_id;

  v_initial_charge_id := null;
  if coalesce(p_create_initial_charge, true) then
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
      v_old_sub.account_id,
      new_subscription_id,
      v_new_plan.price_cents,
      coalesce(v_new_plan.currency, 'USD'),
      v_effective_date,
      v_period_end,
      v_effective_date,
      'open',
      'monthly_period',
      concat_ws(
        ' | ',
        format(
          'Initial monthly charge from per-session conversion (plan %s, effective %s, policy=%s)',
          p_new_plan_definition_id,
          v_effective_date,
          v_policy
        ),
        case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
      )
    )
    returning id into v_initial_charge_id;
  end if;

  old_subscription_id := v_old_sub.id;
  initial_charge_id := v_initial_charge_id;
  automatic_billing_starts_at := v_automatic_billing_starts_at;
  return next;
end;
$$;


comment on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) is
  'Converts an active per-session subscription to monthly. Paid plans persist automatic_billing_starts_at at the next period so recurring generation continues after the optional initial charge.';

revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) from public;
revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) from anon;
revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) from authenticated;
grant execute on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) to service_role;
