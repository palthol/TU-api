-- Primary KPI Validation
-- Target migration: 0013_primary_kpi_summary_view.sql

-- 0) View exists
select table_schema, table_name
from information_schema.views
where table_schema = 'public'
  and table_name = 'view_analytics_primary_kpis_monthly';

-- 1) Smoke
select * from public.view_analytics_primary_kpis_monthly limit 24;

-- 2) Non-negative checks
select *
from public.view_analytics_primary_kpis_monthly
where expected_revenue_open_due_cents < 0
   or actual_revenue_net_cash_cents < 0
   or total_visitors_present_checkins < 0
   or current_monthly_members_active_count < 0;

-- 3) Month alignment
select *
from public.view_analytics_primary_kpis_monthly
where month_start <> date_trunc('month', month_start::timestamp)::date;

-- 4) Current monthly member count consistency against source tables
with current_members as (
  select
    count(*)::integer as expected_current_members
  from public.subscriptions s
  join public.plan_definitions pd on pd.id = s.plan_definition_id
  where s.status = 'active'
    and pd.billing_cadence = 'monthly'
    and s.starts_at <= current_date
    and (s.ends_at is null or s.ends_at >= current_date)
)
select
  v.month_start,
  v.current_monthly_members_active_count,
  cm.expected_current_members
from public.view_analytics_primary_kpis_monthly v
cross join current_members cm
where v.current_monthly_members_active_count <> cm.expected_current_members
limit 20;

