-- Additive reports and explicit no-charge enrollment; no data backfill.
-- Prevent a replacement of a future replacement from overlapping its ancestor.
create or replace function public.transition_billing_obligation(
  p_id uuid, p_action text, p_billing_starts_on date default null
) returns jsonb language plpgsql set search_path = public, private as $$
declare v_row public.billing_obligations; v_old public.billing_obligations;
begin
  -- Same lock as generation: replacements/resumes cannot race a billing run.
  perform pg_advisory_xact_lock(hashtextextended('public.generate_monthly_charges', 0));
  select * into v_row from public.billing_obligations where id = p_id for update;
  if not found then raise exception 'billing_obligation_not_found'; end if;
  if p_action is null or p_action not in ('activate', 'pause', 'end') then raise exception 'invalid_obligation_action'; end if;
  if v_row.status = 'ended' and p_action <> 'end' then raise exception 'ended_obligation_is_terminal'; end if;
  if p_action = 'activate' then
    if p_billing_starts_on is null then raise exception 'billing_start_required'; end if;
    if v_row.status = 'active' then
      if p_billing_starts_on = v_row.billing_starts_on then return to_jsonb(v_row); end if;
      raise exception 'pause_before_changing_billing_start';
    end if;
    if v_row.status = 'paused' and p_billing_starts_on < (now() at time zone 'America/New_York')::date then
      raise exception 'resume_requires_current_or_future_boundary';
    end if;
    if v_row.ends_before is not null and p_billing_starts_on >= v_row.ends_before then
      raise exception 'billing_start_is_after_obligation_end';
    end if;
    if not exists (select 1 from public.accounts where id = v_row.account_id and status = 'active') then
      raise exception 'active_payer_account_required';
    end if;
    if v_row.replaces_obligation_id is not null and v_row.status = 'draft' then
      select * into v_old from public.billing_obligations where id = v_row.replaces_obligation_id for update;
      if v_old.status = 'draft' or v_old.ends_before is not null then raise exception 'replacement_not_available'; end if;
      if p_billing_starts_on <= v_old.anchor_date or
        p_billing_starts_on <> private.billing_anchor_in_month(v_old.anchor_date, p_billing_starts_on) then
        raise exception 'replacement_must_start_at_previous_boundary';
      end if;
      if p_billing_starts_on < v_old.billing_starts_on then
        raise exception 'replacement_precedes_previous_billing_start';
      end if;
      if exists(select 1 from public.charges where billing_obligation_id = v_old.id and coverage_end >= p_billing_starts_on) then
        raise exception 'replacement_overlaps_existing_charge';
      end if;
      update public.billing_obligations set ends_before = p_billing_starts_on where id = v_old.id;
    end if;
    update public.billing_obligations set status = 'active', billing_starts_on = p_billing_starts_on
      where id = p_id returning * into v_row;
  elsif p_action = 'pause' then
    if v_row.status not in ('active', 'paused') then raise exception 'only_active_obligation_can_pause'; end if;
    update public.billing_obligations set status = 'paused' where id = p_id returning * into v_row;
  else
    update public.billing_obligations set status = 'ended' where id = p_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;


-- All charges, including legacy/manual charges, exactly once. Coverage is descriptive.
create or replace view public.view_payer_charge_board with (security_invoker = true) as
select c.id as charge_id, c.account_id, a.primary_contact_name as payer_name,
  c.billing_obligation_id, b.label as obligation_label, b.status as obligation_status,
  b.amount_cents as agreed_amount_cents, b.anchor_date, b.billing_starts_on, b.ends_before,
  c.subscription_id, c.charge_kind, c.currency, c.status as charge_status,
  c.coverage_start, c.coverage_end, c.due_at,
  n.gross_cents, n.credit_applied_cents, n.write_off_cents, n.net_due_cents,
  coalesce(pa.allocated_cents,0)::bigint as allocated_cents,
  case when c.status = 'void' then 0::bigint
       else greatest(0::bigint,n.net_due_cents - coalesce(pa.allocated_cents,0)) end as outstanding_cents,
  coalesce(bp.covered_participants, '[]'::jsonb) as covered_participants
from public.charges c
join public.accounts a on a.id=c.account_id
join public.view_charge_net n on n.charge_id=c.id
left join public.billing_obligations b on b.id=c.billing_obligation_id
left join (
  select charge_id, sum(amount_cents) as allocated_cents
  from public.payment_allocations group by charge_id
) pa on pa.charge_id=c.id
left join (
  select l.obligation_id, jsonb_agg(jsonb_build_object('participant_id',p.id,'name',p.full_name) order by p.id) as covered_participants
  from public.billing_obligation_participants l join public.participants p on p.id=l.participant_id
  group by l.obligation_id
) bp on bp.obligation_id=b.id;

-- Past debt remains visible after pause/end/replacement or payer deactivation.
-- Due-soon means issued debt due within three days, not forecast subscriptions.
create or replace view public.view_payer_payment_reminders with (security_invoker = true) as
select r.*,
  greatest(0, (now() at time zone 'America/New_York')::date-r.due_at) as days_late,
  case when r.due_at < (now() at time zone 'America/New_York')::date
    then 'overdue' else 'due_soon' end as reminder_bucket
from public.view_payer_charge_board r
where r.charge_status <> 'void' and r.outstanding_cents > 0
  and r.due_at <= (now() at time zone 'America/New_York')::date + 3;
revoke all on public.view_payer_charge_board, public.view_payer_payment_reminders from public, anon, authenticated;
grant select on public.view_payer_charge_board, public.view_payer_payment_reminders to service_role;

-- Explicit enrollment/change path for monthly access covered by an agreement.
-- Caller supplies a stable subscription UUID: retries conflict, never add enrollment.
-- Today-only cutover avoids retroactive/future entitlement rewrites in this version.
create or replace function public.enroll_obligation_entitlement(
  p_id uuid, p_obligation_id uuid, p_participant_id uuid, p_plan_definition_id uuid,
  p_replaces_subscription_id uuid default null
) returns jsonb language plpgsql set search_path = public, private as $$
declare
  o public.billing_obligations;
  s public.subscriptions;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('public.generate_monthly_charges',0));
  -- Lock participant too so two distinct IDs cannot concurrently enroll this path.
  perform 1 from public.participants where id=p_participant_id for update;
  if not found then raise exception 'participant_not_found'; end if;
  if exists(select 1 from public.subscriptions where id=p_id) then
    raise exception using errcode='23505', message='subscription_id_already_exists';
  end if;
  select * into o from public.billing_obligations where id=p_obligation_id for update;
  if not found or o.status <> 'active' or (o.ends_before is not null and o.ends_before <= v_today) then
    raise exception 'active_obligation_required';
  end if;
  if not exists(select 1 from public.accounts where id=o.account_id and status='active') then
    raise exception 'active_payer_account_required';
  end if;
  if not exists(select 1 from public.billing_obligation_participants
    where obligation_id=o.id and participant_id=p_participant_id) then
    raise exception 'participant_not_covered_by_obligation';
  end if;
  if not exists(select 1 from public.account_members where account_id=o.account_id and participant_id=p_participant_id) then
    raise exception 'participant_not_in_payer_account';
  end if;
  if not exists(select 1 from public.plan_definitions where id=p_plan_definition_id and is_active and billing_cadence='monthly') then
    raise exception 'active_monthly_plan_required';
  end if;
  if p_replaces_subscription_id is not null then
    select * into s from public.subscriptions where id=p_replaces_subscription_id for update;
    if not found or s.account_id<>o.account_id or s.participant_id<>p_participant_id
      or s.status<>'active' or s.starts_at>=v_today or (s.ends_at is not null and s.ends_at<v_today) then
      raise exception 'invalid_entitlement_predecessor';
    end if;
    -- End access yesterday, retain status/history so date-based access remains valid.
    update public.subscriptions set ends_at=v_today-1 where id=s.id;
  end if;
  if exists(select 1 from public.subscriptions where participant_id=p_participant_id
    and status='active' and (ends_at is null or ends_at>=v_today)) then
    raise exception 'overlapping_active_subscription';
  end if;
  insert into public.subscriptions(id,account_id,participant_id,plan_definition_id,starts_at,status,notes)
    values(p_id,o.account_id,p_participant_id,p_plan_definition_id,v_today,'active',
      'Entitlement only; billing obligation ' || o.id);
  return jsonb_build_object('subscription_id',p_id,'account_id',o.account_id,
    'billing_obligation_id',o.id,'participant_id',p_participant_id,
    'plan_definition_id',p_plan_definition_id,'starts_at',v_today,
    'replaced_subscription_id',p_replaces_subscription_id,'initial_charge_id',null);
end $$;
revoke all on function public.enroll_obligation_entitlement(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.enroll_obligation_entitlement(uuid,uuid,uuid,uuid,uuid) to service_role;
