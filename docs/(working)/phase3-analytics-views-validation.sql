-- Phase 3 Analytics Views Validation
-- Target migration: 0012_phase3_analytics_views.sql

-- ============================================================================
-- 0) Existence + smoke checks
-- ============================================================================
select table_schema, table_name
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'view_analytics_revenue_waterfall_monthly',
    'view_analytics_subscription_movement',
    'view_analytics_attendance_utilization_weekly',
    'view_analytics_entitlement_burn',
    'view_analytics_affiliate_program_performance',
    'view_analytics_data_hygiene'
  )
order by table_name;

select * from public.view_analytics_revenue_waterfall_monthly limit 50;
select * from public.view_analytics_subscription_movement limit 50;
select * from public.view_analytics_attendance_utilization_weekly limit 50;
select * from public.view_analytics_entitlement_burn limit 50;
select * from public.view_analytics_affiliate_program_performance limit 50;
select * from public.view_analytics_data_hygiene limit 50;

-- ============================================================================
-- 1) Revenue waterfall math and non-negative checks
-- ============================================================================
-- Expect net_billed = gross - affiliate - writeoff
select *
from public.view_analytics_revenue_waterfall_monthly v
where v.net_billed_cents <> (v.gross_charged_cents - v.affiliate_credits_applied_cents - v.write_off_cents);

-- Expect net_cash_collected = collected - refunded
select *
from public.view_analytics_revenue_waterfall_monthly v
where v.net_cash_collected_cents <> (v.collected_cents - v.refunded_cents);

-- Non-negative primary components
select *
from public.view_analytics_revenue_waterfall_monthly v
where v.gross_charged_cents < 0
   or v.affiliate_credits_applied_cents < 0
   or v.write_off_cents < 0
   or v.collected_cents < 0
   or v.refunded_cents < 0;

-- ============================================================================
-- 2) Subscription movement consistency checks
-- ============================================================================
select *
from public.view_analytics_subscription_movement v
where v.new_count < 0
   or v.cancelled_count < 0
   or v.paused_count < 0
   or v.expired_count < 0;

-- Check that month_start is month-aligned
select *
from public.view_analytics_subscription_movement v
where v.month_start <> date_trunc('month', v.month_start::timestamp)::date;

-- ============================================================================
-- 3) Weekly utilization bounds and basic sanity
-- ============================================================================
select *
from public.view_analytics_attendance_utilization_weekly v
where v.no_show_rate_percent < 0
   or v.no_show_rate_percent > 100
   or v.session_count < 0
   or v.tracked_attendance_count < 0
   or v.present_count < 0
   or v.no_show_count < 0
   or v.cancelled_count < 0
   or v.unique_participants < 0
   or v.private_minutes_used < 0;

-- ============================================================================
-- 4) Entitlement burn sanity checks
-- ============================================================================
-- remaining should not be negative
select *
from public.view_analytics_entitlement_burn v
where v.remaining is not null
  and v.remaining < 0;

-- usage percent should be non-negative when present
select *
from public.view_analytics_entitlement_burn v
where v.usage_percent_of_limit is not null
  and v.usage_percent_of_limit < 0;

-- overburn risk rows should generally have no availability and zero remaining
select *
from public.view_analytics_entitlement_burn v
where v.overburn_risk = true
  and (v.has_availability = true or coalesce(v.remaining, -1) <> 0);

-- ============================================================================
-- 5) Affiliate performance cross-checks
-- ============================================================================
select *
from public.view_analytics_affiliate_program_performance v
where v.total_referral_count < 0
   or v.active_referral_count < 0
   or v.active_referral_count > v.total_referral_count
   or v.credits_earned_cents < 0
   or v.credits_applied_cents < 0;

-- Liability equation check
select *
from public.view_analytics_affiliate_program_performance v
where v.outstanding_credit_liability_cents <> (v.credits_earned_cents - v.credits_applied_cents);

-- ============================================================================
-- 6) Data hygiene checks
-- ============================================================================
select *
from public.view_analytics_data_hygiene v
where v.hygiene_issue_score < 0
   or v.potential_duplicate_group_size < 1
   or v.account_member_count < 0;

-- Potential duplicate candidates (top 100)
select
  participant_id,
  full_name,
  email,
  date_of_birth,
  potential_duplicate_group_size
from public.view_analytics_data_hygiene
where potential_duplicate_group_size > 1
order by potential_duplicate_group_size desc, full_name asc
limit 100;
