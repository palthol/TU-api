-- Phase 2 High-Impact Views Validation
-- Target migration: 0011_phase2_high_impact_ops_finance_views.sql

-- ============================================================================
-- 0) Existence + shape checks
-- ============================================================================

select table_schema, table_name
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'view_ops_today_sessions',
    'view_ops_upcoming_access_issues',
    'view_ops_waiver_compliance_gaps',
    'view_ops_ar_aging',
    'view_ops_unallocated_or_partial_payment_risk'
  )
order by table_name;

-- Smoke select
select * from public.view_ops_today_sessions limit 20;
select * from public.view_ops_upcoming_access_issues limit 20;
select * from public.view_ops_waiver_compliance_gaps limit 20;
select * from public.view_ops_ar_aging limit 20;
select * from public.view_ops_unallocated_or_partial_payment_risk limit 20;

-- ============================================================================
-- 1) Day-of session behavior
-- ============================================================================
-- Validate no division errors and non-negative counts.
select *
from public.view_ops_today_sessions
where tracked_attendee_count < 0
   or present_count < 0
   or no_show_count < 0
   or cancelled_count < 0
   or filled_percent < 0
   or filled_percent > 100;

-- ============================================================================
-- 2) Upcoming access issue behavior
-- ============================================================================
-- All rows should be flagged as potential issues by definition.
select *
from public.view_ops_upcoming_access_issues
where potential_access_issue is distinct from true;

-- Validate session window constraint (next 14 days).
select *
from public.view_ops_upcoming_access_issues
where next_session_starts_at < now()
   or next_session_starts_at >= now() + interval '14 days';

-- ============================================================================
-- 3) Waiver compliance risk behavior
-- ============================================================================
-- Every row should have at least one compliance gap.
select *
from public.view_ops_waiver_compliance_gaps
where has_compliance_gap is distinct from true
  or not (missing_waiver or missing_emergency_contact or missing_medical_history);

-- ============================================================================
-- 4) AR aging bucket boundaries and totals
-- ============================================================================
-- There should be exactly one total row.
select count(*) as total_rows
from public.view_ops_ar_aging
where scope = 'total';

-- Sum of buckets should equal total_outstanding.
select *
from public.view_ops_ar_aging
where (
  coalesce(bucket_0_30_cents, 0)
  + coalesce(bucket_31_60_cents, 0)
  + coalesce(bucket_61_90_cents, 0)
  + coalesce(bucket_90_plus_cents, 0)
) <> coalesce(total_outstanding_cents, 0);

-- ============================================================================
-- 5) Allocation integrity risk view
-- ============================================================================
-- Sanity: no negative gaps in this view shape.
select *
from public.view_ops_unallocated_or_partial_payment_risk
where gap_cents < 0;

-- Risk types expected only from the defined set.
select risk_type, count(*) as row_count
from public.view_ops_unallocated_or_partial_payment_risk
group by risk_type
order by risk_type;

-- ============================================================================
-- 6) Optional scenario sampling
-- ============================================================================
-- Replace IDs and inspect specific accounts/participants:
-- select * from public.view_ops_ar_aging where account_id = '<account_uuid>'::uuid;
-- select * from public.view_ops_upcoming_access_issues where participant_id = '<participant_uuid>'::uuid;
