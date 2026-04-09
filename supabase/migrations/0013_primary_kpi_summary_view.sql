-- Primary KPI monthly summary view for dashboard console.
-- Metrics:
-- - expected_revenue_open_due_cents (charges due in month, still outstanding)
-- - actual_revenue_net_cash_cents (payments - refunds in month)
-- - total_visitors_present_checkins (present attendance check-ins in month)
-- - current_monthly_members_active_count (active monthly subscriptions as of current_date)

create or replace view public.view_analytics_primary_kpis_monthly
with (security_invoker = on) as
with allocations as (
  select
    pa.charge_id,
    coalesce(sum(pa.amount_cents), 0)::integer as allocated_cents
  from public.payment_allocations pa
  group by pa.charge_id
),
expected_open_due_monthly as (
  select
    date_trunc('month', c.due_at::timestamp)::date as month_start,
    coalesce(
      sum(
        greatest(
          coalesce(vcn.net_due_cents, c.amount_cents)::integer - coalesce(a.allocated_cents, 0)::integer,
          0
        )
      ),
      0
    )::integer as expected_revenue_open_due_cents
  from public.charges c
  left join public.view_charge_net vcn on vcn.charge_id = c.id
  left join allocations a on a.charge_id = c.id
  where c.status <> 'void'
  group by 1
),
actual_revenue_monthly as (
  select
    rw.month_start,
    rw.net_cash_collected_cents::integer as actual_revenue_net_cash_cents
  from public.view_analytics_revenue_waterfall_monthly rw
),
visitors_monthly as (
  select
    date_trunc('month', s.starts_at)::date as month_start,
    count(ar.id) filter (where ar.status = 'present')::integer as total_visitors_present_checkins
  from public.sessions s
  left join public.attendance_records ar on ar.session_id = s.id
  group by 1
),
all_months as (
  select month_start from expected_open_due_monthly
  union
  select month_start from actual_revenue_monthly
  union
  select month_start from visitors_monthly
  union
  select date_trunc('month', current_date::timestamp)::date as month_start
),
current_monthly_members as (
  select
    count(*)::integer as current_monthly_members_active_count
  from public.subscriptions s
  join public.plan_definitions pd on pd.id = s.plan_definition_id
  where s.status = 'active'
    and pd.billing_cadence = 'monthly'
    and s.starts_at <= current_date
    and (s.ends_at is null or s.ends_at >= current_date)
)
select
  m.month_start,
  coalesce(e.expected_revenue_open_due_cents, 0)::integer as expected_revenue_open_due_cents,
  coalesce(a.actual_revenue_net_cash_cents, 0)::integer as actual_revenue_net_cash_cents,
  coalesce(v.total_visitors_present_checkins, 0)::integer as total_visitors_present_checkins,
  cm.current_monthly_members_active_count::integer as current_monthly_members_active_count
from all_months m
left join expected_open_due_monthly e on e.month_start = m.month_start
left join actual_revenue_monthly a on a.month_start = m.month_start
left join visitors_monthly v on v.month_start = m.month_start
cross join current_monthly_members cm
order by m.month_start desc;

comment on view public.view_analytics_primary_kpis_monthly is
'Primary KPI monthly summary for dashboard: expected open due, actual net cash, present check-ins, and current active monthly members.';

revoke all on table public.view_analytics_primary_kpis_monthly from public;
grant select on table public.view_analytics_primary_kpis_monthly to authenticated;

