-- Phase 2 high-impact DB-only operational/finance views.
-- Scope:
--   view_ops_today_sessions
--   view_ops_upcoming_access_issues
--   view_ops_waiver_compliance_gaps
--   view_ops_ar_aging
--   view_ops_unallocated_or_partial_payment_risk

-- ============================================================================
-- 1) Day-of logistics board
-- ============================================================================
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
order by s.starts_at asc, s.id asc;

comment on view public.view_ops_today_sessions is
'Day-of logistics board: session counts by attendance status and present-share percent.';

-- ============================================================================
-- 2) Upcoming access issues
-- ============================================================================
create or replace view public.view_ops_upcoming_access_issues
with (security_invoker = on) as
with upcoming as (
  select
    ar.id as attendance_record_id,
    ar.participant_id,
    ar.status as attendance_status,
    s.id as session_id,
    s.starts_at,
    s.session_label
  from public.attendance_records ar
  join public.sessions s on s.id = ar.session_id
  where s.starts_at >= now()
    and s.starts_at < now() + interval '14 days'
),
entitlement_eval as (
  select
    u.attendance_record_id,
    bool_or(pes.has_availability) as has_group_availability,
    min(pes.remaining) filter (where pes.remaining is not null) as min_remaining
  from upcoming u
  left join public.participant_entitlement_status pes
    on pes.participant_id = u.participant_id
   and pes.scope = 'group'
   and pes.unit = 'session'
   and (
     pes.applies_to is null
     or u.session_label is null
     or pes.applies_to = u.session_label
   )
  group by u.attendance_record_id
),
override_eval as (
  select
    u.attendance_record_id,
    exists (
      select 1
      from public.access_overrides ao
      where ao.participant_id = u.participant_id
        and ao.allow_until > u.starts_at
    ) as override_covers_session
  from upcoming u
)
select
  u.attendance_record_id,
  u.participant_id,
  p.full_name as participant_name,
  u.session_id,
  u.starts_at as next_session_starts_at,
  u.session_label,
  u.attendance_status,
  coalesce(ee.min_remaining, 0)::integer as entitlement_remaining,
  coalesce(ee.has_group_availability, false) as has_availability,
  coalesce(oe.override_covers_session, false) as override_active,
  case
    when coalesce(oe.override_covers_session, false) then false
    when coalesce(ee.has_group_availability, false) then false
    else true
  end as potential_access_issue,
  case
    when coalesce(oe.override_covers_session, false) then 'override_grants_access'
    when coalesce(ee.has_group_availability, false) then 'entitlement_available'
    else 'no_entitlement_or_remaining'
  end as issue_reason
from upcoming u
join public.participants p on p.id = u.participant_id
left join entitlement_eval ee on ee.attendance_record_id = u.attendance_record_id
left join override_eval oe on oe.attendance_record_id = u.attendance_record_id
where (
  case
    when coalesce(oe.override_covers_session, false) then false
    when coalesce(ee.has_group_availability, false) then false
    else true
  end
) = true
order by u.starts_at asc, p.full_name asc;

comment on view public.view_ops_upcoming_access_issues is
'Upcoming attendance rows likely blocked by missing availability without active override.';

-- ============================================================================
-- 3) Waiver compliance risk queue
-- ============================================================================
create or replace view public.view_ops_waiver_compliance_gaps
with (security_invoker = on) as
with active_participants as (
  select distinct
    s.participant_id,
    s.account_id
  from public.subscriptions s
  where s.status = 'active'
    and s.starts_at <= current_date
    and (s.ends_at is null or s.ends_at >= current_date)
),
waiver_rollup as (
  select
    w.participant_id,
    count(*)::integer as waiver_count,
    max(w.signed_at_utc) as latest_waiver_at
  from public.waivers w
  group by w.participant_id
),
contact_rollup as (
  select
    ec.participant_id,
    count(*)::integer as emergency_contact_count
  from public.emergency_contacts ec
  group by ec.participant_id
),
medical_rollup as (
  select
    w.participant_id,
    count(mh.id)::integer as medical_history_count
  from public.waivers w
  left join public.waiver_medical_histories mh on mh.waiver_id = w.id
  group by w.participant_id
)
select
  ap.account_id,
  ap.participant_id,
  p.full_name as participant_name,
  p.email as participant_email,
  coalesce(wr.waiver_count, 0) as waiver_count,
  wr.latest_waiver_at,
  coalesce(cr.emergency_contact_count, 0) as emergency_contact_count,
  coalesce(mr.medical_history_count, 0) as medical_history_count,
  (coalesce(wr.waiver_count, 0) = 0) as missing_waiver,
  (coalesce(cr.emergency_contact_count, 0) = 0) as missing_emergency_contact,
  (coalesce(mr.medical_history_count, 0) = 0) as missing_medical_history,
  (
    (coalesce(wr.waiver_count, 0) = 0)
    or (coalesce(cr.emergency_contact_count, 0) = 0)
    or (coalesce(mr.medical_history_count, 0) = 0)
  ) as has_compliance_gap
from active_participants ap
join public.participants p on p.id = ap.participant_id
left join waiver_rollup wr on wr.participant_id = ap.participant_id
left join contact_rollup cr on cr.participant_id = ap.participant_id
left join medical_rollup mr on mr.participant_id = ap.participant_id
where (
  (coalesce(wr.waiver_count, 0) = 0)
  or (coalesce(cr.emergency_contact_count, 0) = 0)
  or (coalesce(mr.medical_history_count, 0) = 0)
)
order by p.full_name asc;

comment on view public.view_ops_waiver_compliance_gaps is
'Active participants with missing waiver, emergency contact, or medical history records.';

-- ============================================================================
-- 4) AR aging by account + total
-- ============================================================================
create or replace view public.view_ops_ar_aging
with (security_invoker = on) as
with allocations as (
  select
    pa.charge_id,
    coalesce(sum(pa.amount_cents), 0)::integer as allocated_cents
  from public.payment_allocations pa
  group by pa.charge_id
),
balances as (
  select
    c.id as charge_id,
    c.account_id,
    c.due_at,
    coalesce(vcn.net_due_cents, c.amount_cents)::integer as expected_due_cents,
    coalesce(a.allocated_cents, 0)::integer as allocated_cents,
    greatest(coalesce(vcn.net_due_cents, c.amount_cents)::integer - coalesce(a.allocated_cents, 0)::integer, 0)::integer as outstanding_cents,
    greatest((current_date - c.due_at), 0)::integer as days_past_due
  from public.charges c
  left join allocations a on a.charge_id = c.id
  left join public.view_charge_net vcn on vcn.charge_id = c.id
  where c.status <> 'void'
)
select
  case when grouping(b.account_id) = 1 then 'total' else 'account' end as scope,
  b.account_id,
  count(*) filter (where b.outstanding_cents > 0)::integer as open_item_count,
  coalesce(sum(b.outstanding_cents) filter (where b.outstanding_cents > 0), 0)::integer as total_outstanding_cents,
  coalesce(sum(
    case when b.outstanding_cents > 0 and b.days_past_due between 0 and 30 then b.outstanding_cents else 0 end
  ), 0)::integer as bucket_0_30_cents,
  coalesce(sum(
    case when b.outstanding_cents > 0 and b.days_past_due between 31 and 60 then b.outstanding_cents else 0 end
  ), 0)::integer as bucket_31_60_cents,
  coalesce(sum(
    case when b.outstanding_cents > 0 and b.days_past_due between 61 and 90 then b.outstanding_cents else 0 end
  ), 0)::integer as bucket_61_90_cents,
  coalesce(sum(
    case when b.outstanding_cents > 0 and b.days_past_due > 90 then b.outstanding_cents else 0 end
  ), 0)::integer as bucket_90_plus_cents
from balances b
group by grouping sets ((b.account_id), ());

comment on view public.view_ops_ar_aging is
'AR aging buckets (0-30, 31-60, 61-90, 90+) by account plus total rollup.';

-- ============================================================================
-- 5) Payment allocation integrity risk queue
-- ============================================================================
create or replace view public.view_ops_unallocated_or_partial_payment_risk
with (security_invoker = on) as
with payment_alloc as (
  select
    pa.payment_id,
    coalesce(sum(pa.amount_cents), 0)::integer as allocated_cents
  from public.payment_allocations pa
  group by pa.payment_id
),
payment_risks as (
  select
    'payment_unallocated'::text as risk_type,
    p.account_id,
    null::uuid as participant_id,
    p.id as payment_id,
    null::uuid as charge_id,
    null::uuid as subscription_id,
    p.amount_cents::integer as amount_cents,
    coalesce(pa.allocated_cents, 0)::integer as allocated_cents,
    null::integer as expected_cents,
    greatest(p.amount_cents::integer - coalesce(pa.allocated_cents, 0)::integer, 0)::integer as gap_cents,
    null::date as due_at,
    null::integer as days_past_due,
    jsonb_build_object(
      'payment_status', p.status,
      'method', p.method,
      'paid_at', p.paid_at
    ) as risk_context
  from public.payments p
  left join payment_alloc pa on pa.payment_id = p.id
  where p.status in ('pending', 'succeeded')
    and greatest(p.amount_cents::integer - coalesce(pa.allocated_cents, 0)::integer, 0) > 0
),
charge_alloc as (
  select
    c.id as charge_id,
    c.account_id,
    c.subscription_id,
    c.due_at,
    c.amount_cents::integer as gross_cents,
    coalesce(vcn.net_due_cents, c.amount_cents)::integer as expected_cents,
    coalesce(sum(pa.amount_cents), 0)::integer as allocated_cents
  from public.charges c
  left join public.payment_allocations pa on pa.charge_id = c.id
  left join public.view_charge_net vcn on vcn.charge_id = c.id
  where c.status <> 'void'
  group by c.id, c.account_id, c.subscription_id, c.due_at, c.amount_cents, vcn.net_due_cents
),
charge_risks as (
  select
    case
      when ca.allocated_cents > ca.expected_cents then 'charge_overallocated'
      else 'charge_partially_allocated'
    end::text as risk_type,
    ca.account_id,
    s.participant_id,
    null::uuid as payment_id,
    ca.charge_id,
    ca.subscription_id,
    ca.gross_cents::integer as amount_cents,
    ca.allocated_cents::integer as allocated_cents,
    ca.expected_cents::integer as expected_cents,
    case
      when ca.allocated_cents > ca.expected_cents then (ca.allocated_cents - ca.expected_cents)::integer
      else (ca.expected_cents - ca.allocated_cents)::integer
    end as gap_cents,
    ca.due_at,
    greatest((current_date - ca.due_at), 0)::integer as days_past_due,
    jsonb_build_object(
      'gross_cents', ca.gross_cents,
      'expected_net_due_cents', ca.expected_cents
    ) as risk_context
  from charge_alloc ca
  left join public.subscriptions s on s.id = ca.subscription_id
  where (
    (ca.allocated_cents > 0 and ca.allocated_cents < ca.expected_cents)
    or (ca.allocated_cents > ca.expected_cents)
  )
)
select *
from (
  select * from payment_risks
  union all
  select * from charge_risks
) r
order by
  case r.risk_type
    when 'charge_overallocated' then 1
    when 'charge_partially_allocated' then 2
    when 'payment_unallocated' then 3
    else 4
  end,
  coalesce(r.days_past_due, 0) desc,
  r.account_id;

comment on view public.view_ops_unallocated_or_partial_payment_risk is
'Risk queue for unallocated payments, partially allocated charges, and overallocated charges.';

-- ============================================================================
-- Grants
-- ============================================================================
revoke all on public.view_ops_today_sessions from public;
revoke all on public.view_ops_upcoming_access_issues from public;
revoke all on public.view_ops_waiver_compliance_gaps from public;
revoke all on public.view_ops_ar_aging from public;
revoke all on public.view_ops_unallocated_or_partial_payment_risk from public;

grant select on public.view_ops_today_sessions to authenticated;
grant select on public.view_ops_upcoming_access_issues to authenticated;
grant select on public.view_ops_waiver_compliance_gaps to authenticated;
grant select on public.view_ops_ar_aging to authenticated;
grant select on public.view_ops_unallocated_or_partial_payment_risk to authenticated;
