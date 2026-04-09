-- Pay-per-class charge creation from attendance (manual trigger) and
-- conversion flow from per-session billing to monthly subscriptions.

-- -----------------------------------------------------------------------------
-- class_charge_links
-- -----------------------------------------------------------------------------
create table if not exists public.class_charge_links (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null references public.attendance_records(id) on delete cascade,
  charge_id uuid not null references public.charges(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text,
  constraint class_charge_links_attendance_unique unique (attendance_record_id),
  constraint class_charge_links_charge_unique unique (charge_id)
);

create index if not exists idx_class_charge_links_charge_id on public.class_charge_links(charge_id);

alter table public.class_charge_links enable row level security;

create policy "admin_all_class_charge_links" on public.class_charge_links
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

comment on table public.class_charge_links is
  'Links one attendance record to one generated pay-per-class charge.';

-- -----------------------------------------------------------------------------
-- create_pay_per_class_charge
-- Manual-only charge creation from attendance row (status must be present).
-- -----------------------------------------------------------------------------
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
  'Creates one per-session charge from one present attendance record. Idempotent via class_charge_links.';

-- -----------------------------------------------------------------------------
-- upgrade_per_class_to_monthly
-- Ends active per-session subscription and creates a monthly subscription.
-- No credit carryover. Optionally creates an initial monthly charge immediately.
-- -----------------------------------------------------------------------------
create or replace function public.upgrade_per_class_to_monthly(
  p_participant_id uuid,
  p_new_plan_definition_id uuid,
  p_effective_date date default current_date,
  p_create_initial_charge boolean default true,
  p_notes text default null
)
returns table (
  old_subscription_id uuid,
  new_subscription_id uuid,
  initial_charge_id uuid
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
begin
  if p_participant_id is null then
    raise exception 'participant id is required';
  end if;
  if p_new_plan_definition_id is null then
    raise exception 'new plan definition id is required';
  end if;

  v_effective_date := coalesce(p_effective_date, current_date);

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
      format('Converted to monthly plan %s effective %s (no credit carryover)', p_new_plan_definition_id, v_effective_date),
      case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
    )
  where s.id = v_old_sub.id;

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
    v_old_sub.account_id,
    p_participant_id,
    p_new_plan_definition_id,
    'active',
    v_effective_date,
    null,
    concat_ws(
      ' | ',
      format('Converted from per-session subscription %s (no credit carryover)', v_old_sub.id),
      case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
    )
  )
  returning id into new_subscription_id;

  v_initial_charge_id := null;
  if coalesce(p_create_initial_charge, true) then
    v_coverage_end := (date_trunc('month', v_effective_date) + interval '1 month - 1 day')::date;

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
      v_old_sub.account_id,
      new_subscription_id,
      v_new_plan.price_cents,
      coalesce(v_new_plan.currency, 'USD'),
      v_effective_date,
      greatest(v_effective_date, v_coverage_end),
      v_effective_date,
      'open',
      concat_ws(
        ' | ',
        format(
          'Initial monthly charge from per-session conversion (plan %s, effective %s)',
          p_new_plan_definition_id,
          v_effective_date
        ),
        case when p_notes is not null and btrim(p_notes) <> '' then btrim(p_notes) else null end
      )
    )
    returning id into v_initial_charge_id;
  end if;

  old_subscription_id := v_old_sub.id;
  initial_charge_id := v_initial_charge_id;
  return next;
end;
$$;

comment on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text) is
  'Converts active per-session subscription to monthly. No carryover credit. Optionally creates initial monthly charge.';

-- Restrict execute to service_role only (internal/admin API usage).
revoke all on function public.create_pay_per_class_charge(uuid, date, text, text) from public;
revoke all on function public.create_pay_per_class_charge(uuid, date, text, text) from anon;
revoke all on function public.create_pay_per_class_charge(uuid, date, text, text) from authenticated;
grant execute on function public.create_pay_per_class_charge(uuid, date, text, text) to service_role;

revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text) from public;
revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text) from anon;
revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text) from authenticated;
grant execute on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text) to service_role;
