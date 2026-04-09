-- Phase 3 analytics scaffold views (DB-ready).
-- Views:
--   view_analytics_revenue_waterfall_monthly
--   view_analytics_subscription_movement
--   view_analytics_attendance_utilization_weekly
--   view_analytics_entitlement_burn
--   view_analytics_affiliate_program_performance
--   view_analytics_data_hygiene

-- ============================================================================
-- 1) Revenue waterfall (monthly)
-- ============================================================================
create or replace view public.view_analytics_revenue_waterfall_monthly
with (security_invoker = on) as
with charge_monthly as (
  select
    date_trunc('month', coalesce(c.coverage_start::timestamp, c.due_at::timestamp, c.created_at))::date as month_start,
    coalesce(sum(c.amount_cents), 0)::integer as gross_charged_cents
  from public.charges c
  where c.status <> 'void'
  group by 1
),
affiliate_applied_monthly as (
  select
    date_trunc('month', coalesce(c.coverage_start::timestamp, c.due_at::timestamp, c.created_at))::date as month_start,
    coalesce(sum(aca.amount_cents), 0)::integer as affiliate_credits_applied_cents
  from public.affiliate_credit_applications aca
  join public.charges c on c.id = aca.charge_id
  group by 1
),
writeoff_monthly as (
  select
    date_trunc('month', coalesce(c.coverage_start::timestamp, c.due_at::timestamp, c.created_at))::date as month_start,
    coalesce(sum(ca.amount_cents), 0)::integer as write_off_cents
  from public.charge_adjustments ca
  join public.charges c on c.id = ca.charge_id
  where ca.adjustment_type = 'write_off'
  group by 1
),
payments_monthly as (
  select
    date_trunc('month', p.paid_at)::date as month_start,
    coalesce(sum(p.amount_cents), 0)::integer as collected_cents
  from public.payments p
  where p.status = 'succeeded'
  group by 1
),
refunds_monthly as (
  select
    date_trunc('month', pr.created_at)::date as month_start,
    coalesce(sum(pr.amount_cents), 0)::integer as refunded_cents
  from public.payment_refunds pr
  group by 1
),
all_months as (
  select month_start from charge_monthly
  union
  select month_start from affiliate_applied_monthly
  union
  select month_start from writeoff_monthly
  union
  select month_start from payments_monthly
  union
  select month_start from refunds_monthly
)
select
  m.month_start,
  coalesce(cm.gross_charged_cents, 0)::integer as gross_charged_cents,
  coalesce(am.affiliate_credits_applied_cents, 0)::integer as affiliate_credits_applied_cents,
  coalesce(wm.write_off_cents, 0)::integer as write_off_cents,
  (
    coalesce(cm.gross_charged_cents, 0)
    - coalesce(am.affiliate_credits_applied_cents, 0)
    - coalesce(wm.write_off_cents, 0)
  )::integer as net_billed_cents,
  coalesce(pm.collected_cents, 0)::integer as collected_cents,
  coalesce(rm.refunded_cents, 0)::integer as refunded_cents,
  (coalesce(pm.collected_cents, 0) - coalesce(rm.refunded_cents, 0))::integer as net_cash_collected_cents
from all_months m
left join charge_monthly cm on cm.month_start = m.month_start
left join affiliate_applied_monthly am on am.month_start = m.month_start
left join writeoff_monthly wm on wm.month_start = m.month_start
left join payments_monthly pm on pm.month_start = m.month_start
left join refunds_monthly rm on rm.month_start = m.month_start
order by m.month_start desc;

comment on view public.view_analytics_revenue_waterfall_monthly is
'Monthly finance waterfall: gross charges, concessions (affiliate credits/write-offs), refunds, and net cash collected.';

-- ============================================================================
-- 2) Subscription movement (monthly by plan)
-- ============================================================================
create or replace view public.view_analytics_subscription_movement
with (security_invoker = on) as
with starts as (
  select
    date_trunc('month', s.starts_at::timestamp)::date as month_start,
    s.plan_definition_id,
    count(*)::integer as new_count
  from public.subscriptions s
  group by 1, 2
),
cancelled as (
  select
    date_trunc('month', s.cancelled_at)::date as month_start,
    s.plan_definition_id,
    count(*)::integer as cancelled_count
  from public.subscriptions s
  where s.cancelled_at is not null
  group by 1, 2
),
paused as (
  select
    date_trunc('month', s.updated_at)::date as month_start,
    s.plan_definition_id,
    count(*)::integer as paused_count
  from public.subscriptions s
  where s.status = 'paused'
  group by 1, 2
),
expired as (
  select
    date_trunc('month', coalesce(s.ends_at::timestamp, s.updated_at))::date as month_start,
    s.plan_definition_id,
    count(*)::integer as expired_count
  from public.subscriptions s
  where s.status = 'expired'
  group by 1, 2
),
keys as (
  select month_start, plan_definition_id from starts
  union
  select month_start, plan_definition_id from cancelled
  union
  select month_start, plan_definition_id from paused
  union
  select month_start, plan_definition_id from expired
)
select
  k.month_start,
  k.plan_definition_id,
  pd.name as plan_name,
  pd.billing_cadence,
  coalesce(st.new_count, 0)::integer as new_count,
  coalesce(ca.cancelled_count, 0)::integer as cancelled_count,
  coalesce(pa.paused_count, 0)::integer as paused_count,
  coalesce(ex.expired_count, 0)::integer as expired_count
from keys k
left join public.plan_definitions pd on pd.id = k.plan_definition_id
left join starts st on st.month_start = k.month_start and st.plan_definition_id = k.plan_definition_id
left join cancelled ca on ca.month_start = k.month_start and ca.plan_definition_id = k.plan_definition_id
left join paused pa on pa.month_start = k.month_start and pa.plan_definition_id = k.plan_definition_id
left join expired ex on ex.month_start = k.month_start and ex.plan_definition_id = k.plan_definition_id
order by k.month_start desc, pd.name asc nulls last;

comment on view public.view_analytics_subscription_movement is
'Monthly subscription movement by plan: new, cancelled, paused, expired.';

-- ============================================================================
-- 3) Attendance utilization (weekly)
-- ============================================================================
create or replace view public.view_analytics_attendance_utilization_weekly
with (security_invoker = on) as
with attendance_weekly as (
  select
    date_trunc('week', s.starts_at)::date as week_start,
    count(distinct s.id)::integer as session_count,
    count(ar.id)::integer as tracked_attendance_count,
    count(*) filter (where ar.status = 'present')::integer as present_count,
    count(*) filter (where ar.status = 'no_show')::integer as no_show_count,
    count(*) filter (where ar.status = 'cancelled')::integer as cancelled_count,
    count(distinct ar.participant_id)::integer as unique_participants
  from public.sessions s
  left join public.attendance_records ar on ar.session_id = s.id
  group by 1
),
private_usage_weekly as (
  select
    date_trunc('week', pu.occurred_at)::date as week_start,
    coalesce(sum(pu.minutes_used), 0)::integer as private_minutes_used
  from public.private_usage pu
  group by 1
),
keys as (
  select week_start from attendance_weekly
  union
  select week_start from private_usage_weekly
)
select
  k.week_start,
  coalesce(aw.session_count, 0)::integer as session_count,
  coalesce(aw.tracked_attendance_count, 0)::integer as tracked_attendance_count,
  coalesce(aw.present_count, 0)::integer as present_count,
  coalesce(aw.no_show_count, 0)::integer as no_show_count,
  coalesce(aw.cancelled_count, 0)::integer as cancelled_count,
  coalesce(aw.unique_participants, 0)::integer as unique_participants,
  coalesce(puw.private_minutes_used, 0)::integer as private_minutes_used,
  case
    when coalesce(aw.tracked_attendance_count, 0) = 0 then 0::numeric(6,2)
    else round((coalesce(aw.no_show_count, 0)::numeric * 100.0) / aw.tracked_attendance_count::numeric, 2)
  end as no_show_rate_percent
from keys k
left join attendance_weekly aw on aw.week_start = k.week_start
left join private_usage_weekly puw on puw.week_start = k.week_start
order by k.week_start desc;

comment on view public.view_analytics_attendance_utilization_weekly is
'Weekly attendance/utilization metrics including no-show rate and private minutes.';

-- ============================================================================
-- 4) Entitlement burn (current state by participant/plan)
-- ============================================================================
create or replace view public.view_analytics_entitlement_burn
with (security_invoker = on) as
select
  pes.participant_id,
  p.full_name as participant_name,
  pes.subscription_id,
  s.plan_definition_id,
  pd.name as plan_name,
  pd.billing_cadence,
  pes.entitlement_id,
  pes.scope,
  pes.unit,
  pes.limit_type,
  pes.entitlement_limit,
  pes.reset_rule,
  pes.applies_to,
  pes.sessions_used,
  pes.minutes_used,
  pes.credits_available,
  pes.has_availability,
  pes.remaining,
  case
    when pes.scope = 'group' and pes.unit = 'session' then coalesce(pes.sessions_used, 0)
    when pes.scope = 'private' and pes.unit = 'minutes' then coalesce(pes.minutes_used, 0)
    else 0
  end::integer as used_quantity,
  case
    when pes.limit_type = 'limited' and pes.entitlement_limit is not null and pes.entitlement_limit > 0 then
      round((
        case
          when pes.scope = 'group' and pes.unit = 'session' then coalesce(pes.sessions_used, 0)::numeric
          when pes.scope = 'private' and pes.unit = 'minutes' then coalesce(pes.minutes_used, 0)::numeric
          else 0::numeric
        end * 100.0
      ) / pes.entitlement_limit::numeric, 2)
    else null::numeric(8,2)
  end as usage_percent_of_limit,
  case
    when pes.limit_type = 'limited' and coalesce(pes.remaining, 0) = 0 and pes.has_availability = false then true
    else false
  end as overburn_risk
from public.participant_entitlement_status pes
left join public.subscriptions s on s.id = pes.subscription_id
left join public.plan_definitions pd on pd.id = s.plan_definition_id
left join public.participants p on p.id = pes.participant_id;

comment on view public.view_analytics_entitlement_burn is
'Current entitlement burn by participant/plan with usage %, remaining, and overburn risk flag.';

-- ============================================================================
-- 5) Affiliate program performance (by referrer participant)
-- ============================================================================
create or replace view public.view_analytics_affiliate_program_performance
with (security_invoker = on) as
with referral_counts as (
  select
    ar.referrer_participant_id,
    count(*)::integer as total_referral_count,
    count(*) filter (where ar.status = 'active' and ar.ended_at is null)::integer as active_referral_count
  from public.affiliate_referrals ar
  group by ar.referrer_participant_id
),
credits_earned as (
  select
    ac.referrer_participant_id,
    coalesce(sum(ac.amount_cents), 0)::integer as credits_earned_cents,
    max(ac.earned_at) as last_credit_earned_at
  from public.affiliate_credits ac
  group by ac.referrer_participant_id
),
credits_applied as (
  select
    s.participant_id as referrer_participant_id,
    coalesce(sum(aca.amount_cents), 0)::integer as credits_applied_cents
  from public.affiliate_credit_applications aca
  join public.charges c on c.id = aca.charge_id
  join public.subscriptions s on s.id = c.subscription_id
  group by s.participant_id
),
keys as (
  select referrer_participant_id from referral_counts
  union
  select referrer_participant_id from credits_earned
  union
  select referrer_participant_id from credits_applied
)
select
  k.referrer_participant_id,
  p.full_name as referrer_name,
  p.email as referrer_email,
  coalesce(rc.total_referral_count, 0)::integer as total_referral_count,
  coalesce(rc.active_referral_count, 0)::integer as active_referral_count,
  coalesce(ce.credits_earned_cents, 0)::integer as credits_earned_cents,
  coalesce(ca.credits_applied_cents, 0)::integer as credits_applied_cents,
  (coalesce(ce.credits_earned_cents, 0) - coalesce(ca.credits_applied_cents, 0))::integer as outstanding_credit_liability_cents,
  ce.last_credit_earned_at
from keys k
left join public.participants p on p.id = k.referrer_participant_id
left join referral_counts rc on rc.referrer_participant_id = k.referrer_participant_id
left join credits_earned ce on ce.referrer_participant_id = k.referrer_participant_id
left join credits_applied ca on ca.referrer_participant_id = k.referrer_participant_id
order by outstanding_credit_liability_cents desc, referrer_name asc nulls last;

comment on view public.view_analytics_affiliate_program_performance is
'Affiliate performance by referrer: referral counts, earned/applied credits, and outstanding liability.';

-- ============================================================================
-- 6) Data hygiene (participant-level issues)
-- ============================================================================
create or replace view public.view_analytics_data_hygiene
with (security_invoker = on) as
with account_link_counts as (
  select
    am.participant_id,
    count(*)::integer as account_member_count
  from public.account_members am
  group by am.participant_id
),
dup_groups as (
  select
    p.id as participant_id,
    count(*) over (
      partition by lower(coalesce(p.email, '')), p.date_of_birth
    )::integer as duplicate_group_size
  from public.participants p
  where p.email is not null
),
orphans as (
  select ow.participant_id
  from public.view_orphan_waivers ow
)
select
  p.id as participant_id,
  p.full_name,
  p.email,
  p.date_of_birth,
  p.created_at,
  (p.merged_into_participant_id is not null) as is_merged,
  p.merged_into_participant_id,
  coalesce(alc.account_member_count, 0)::integer as account_member_count,
  coalesce(dg.duplicate_group_size, 1)::integer as potential_duplicate_group_size,
  (o.participant_id is not null) as has_waiver_without_account_link,
  (coalesce(alc.account_member_count, 0) = 0) as has_no_account_link,
  (p.email is null or btrim(p.email) = '') as missing_email,
  ((p.cell_phone is null or btrim(p.cell_phone) = '') and (p.home_phone is null or btrim(p.home_phone) = '')) as missing_phone,
  (
    case when p.merged_into_participant_id is not null then 1 else 0 end
    + case when coalesce(dg.duplicate_group_size, 1) > 1 then 1 else 0 end
    + case when o.participant_id is not null then 1 else 0 end
    + case when coalesce(alc.account_member_count, 0) = 0 then 1 else 0 end
    + case when (p.email is null or btrim(p.email) = '') then 1 else 0 end
    + case when ((p.cell_phone is null or btrim(p.cell_phone) = '') and (p.home_phone is null or btrim(p.home_phone) = '')) then 1 else 0 end
  )::integer as hygiene_issue_score
from public.participants p
left join account_link_counts alc on alc.participant_id = p.id
left join dup_groups dg on dg.participant_id = p.id
left join orphans o on o.participant_id = p.id
order by hygiene_issue_score desc, p.full_name asc;

comment on view public.view_analytics_data_hygiene is
'Participant-level hygiene indicators: merge flags, potential duplicates, orphan links, and missing contacts.';

-- ============================================================================
-- Grants
-- ============================================================================
revoke all on public.view_analytics_revenue_waterfall_monthly from public;
revoke all on public.view_analytics_subscription_movement from public;
revoke all on public.view_analytics_attendance_utilization_weekly from public;
revoke all on public.view_analytics_entitlement_burn from public;
revoke all on public.view_analytics_affiliate_program_performance from public;
revoke all on public.view_analytics_data_hygiene from public;

grant select on public.view_analytics_revenue_waterfall_monthly to authenticated;
grant select on public.view_analytics_subscription_movement to authenticated;
grant select on public.view_analytics_attendance_utilization_weekly to authenticated;
grant select on public.view_analytics_entitlement_burn to authenticated;
grant select on public.view_analytics_affiliate_program_performance to authenticated;
grant select on public.view_analytics_data_hygiene to authenticated;
