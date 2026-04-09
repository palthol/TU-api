-- Add explicit conversion policy mode to per-class -> monthly upgrade RPC.
-- This is a forward migration that supersedes the 0008 function signature.

-- Drop prior 5-arg signature so callers consistently hit the policy-aware function.
drop function if exists public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text);

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
  return next;
end;
$$;

comment on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) is
  'Converts active per-session subscription to monthly using an explicit conversion policy (no_credit or manual_writeoff_allowed).';

revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) from public;
revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) from anon;
revoke all on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) from authenticated;
grant execute on function public.upgrade_per_class_to_monthly(uuid, uuid, date, boolean, text, text) to service_role;
