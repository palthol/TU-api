/**
 * Read-only reporting: SELECT from whitelisted views (service role bypasses RLS).
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */

/** Slug -> exact Postgres view name (public schema) */
export const REPORTING_VIEWS = Object.freeze({
  'primary-kpis': 'view_analytics_primary_kpis_monthly',
  'payment-board': 'view_member_payment_board',
  'payment-reminders': 'view_member_payment_reminders',
  'orphan-waivers': 'view_orphan_waivers',
  'orphan-waiver-summary': 'view_orphan_waiver_summary',
  'charge-net': 'view_charge_net',
  'waiver-documents': 'view_waiver_documents',
  'participant-entitlements': 'participant_entitlement_status',
  'today-sessions': 'view_ops_today_sessions',
  'upcoming-access-issues': 'view_ops_upcoming_access_issues',
  'waiver-compliance-gaps': 'view_ops_waiver_compliance_gaps',
  'ar-aging': 'view_ops_ar_aging',
  'payment-risk': 'view_ops_unallocated_or_partial_payment_risk',
  'revenue-waterfall-monthly': 'view_analytics_revenue_waterfall_monthly',
  'subscription-movement': 'view_analytics_subscription_movement',
  'attendance-utilization-weekly': 'view_analytics_attendance_utilization_weekly',
  'entitlement-burn': 'view_analytics_entitlement_burn',
  'affiliate-performance': 'view_analytics_affiliate_program_performance',
  'data-hygiene': 'view_analytics_data_hygiene',
});

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;
const MAX_OFFSET = 100000;

const parseNonNegativeInt = (raw) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const REPORTING_VIEW_CONFIG = Object.freeze({
  'primary-kpis': {
    dateColumn: 'month_start',
    defaultSort: 'month_start',
    sortableColumns: [
      'month_start',
      'expected_revenue_open_due_cents',
      'actual_revenue_net_cash_cents',
      'total_visitors_present_checkins',
      'current_monthly_members_active_count',
    ],
  },
  'payment-board': {
    dateColumn: 'next_due_date',
    defaultSort: 'days_late',
    sortableColumns: ['name', 'days_late', 'next_due_date', 'actual_price', 'base_price'],
  },
  'payment-reminders': {
    dateColumn: 'next_due_date',
    defaultSort: 'next_due_date',
    sortableColumns: ['name', 'days_late', 'next_due_date', 'actual_price', 'base_price', 'reminder_bucket'],
  },
  'orphan-waivers': {
    dateColumn: 'latest_waiver_at',
    defaultSort: 'latest_waiver_at',
    sortableColumns: ['full_name', 'email', 'waiver_count', 'latest_waiver_at', 'first_waiver_at'],
  },
  'orphan-waiver-summary': {
    dateColumn: null,
    defaultSort: null,
    sortableColumns: [],
  },
  'charge-net': {
    dateColumn: 'due_at',
    defaultSort: 'due_at',
    sortableColumns: ['due_at', 'gross_cents', 'credit_applied_cents', 'write_off_cents', 'net_due_cents'],
  },
  'waiver-documents': {
    dateColumn: 'signed_at_utc',
    defaultSort: 'signed_at_utc',
    sortableColumns: ['participant_full_name', 'signed_at_utc', 'audit_created_at'],
  },
  'participant-entitlements': {
    dateColumn: null,
    defaultSort: 'participant_id',
    sortableColumns: ['participant_id', 'scope', 'unit', 'remaining', 'has_availability', 'sessions_used', 'minutes_used'],
  },
  'today-sessions': {
    dateColumn: 'starts_at',
    defaultSort: 'starts_at',
    sortableColumns: ['starts_at', 'session_label', 'tracked_attendee_count', 'present_count', 'no_show_count', 'cancelled_count', 'filled_percent'],
  },
  'upcoming-access-issues': {
    dateColumn: 'next_session_starts_at',
    defaultSort: 'next_session_starts_at',
    sortableColumns: ['next_session_starts_at', 'participant_name', 'entitlement_remaining', 'has_availability', 'override_active', 'issue_reason'],
  },
  'waiver-compliance-gaps': {
    dateColumn: 'latest_waiver_at',
    defaultSort: 'participant_name',
    sortableColumns: ['participant_name', 'latest_waiver_at', 'waiver_count', 'emergency_contact_count', 'medical_history_count'],
  },
  'ar-aging': {
    dateColumn: null,
    defaultSort: 'total_outstanding_cents',
    sortableColumns: ['scope', 'open_item_count', 'total_outstanding_cents', 'bucket_0_30_cents', 'bucket_31_60_cents', 'bucket_61_90_cents', 'bucket_90_plus_cents'],
  },
  'payment-risk': {
    dateColumn: 'due_at',
    defaultSort: 'days_past_due',
    sortableColumns: ['risk_type', 'account_id', 'participant_id', 'gap_cents', 'days_past_due', 'due_at'],
  },
  'revenue-waterfall-monthly': {
    dateColumn: 'month_start',
    defaultSort: 'month_start',
    sortableColumns: ['month_start', 'gross_charged_cents', 'affiliate_credits_applied_cents', 'write_off_cents', 'net_billed_cents', 'collected_cents', 'refunded_cents', 'net_cash_collected_cents'],
    filters: {
      min_net_cash_cents: { column: 'net_cash_collected_cents', op: 'gte' },
      min_collected_cents: { column: 'collected_cents', op: 'gte' },
      max_refunded_cents: { column: 'refunded_cents', op: 'lte' },
    },
  },
  'subscription-movement': {
    dateColumn: 'month_start',
    defaultSort: 'month_start',
    sortableColumns: ['month_start', 'plan_name', 'billing_cadence', 'new_count', 'cancelled_count', 'paused_count', 'expired_count'],
  },
  'attendance-utilization-weekly': {
    dateColumn: 'week_start',
    defaultSort: 'week_start',
    sortableColumns: ['week_start', 'session_count', 'tracked_attendance_count', 'present_count', 'no_show_count', 'cancelled_count', 'unique_participants', 'private_minutes_used', 'no_show_rate_percent'],
  },
  'entitlement-burn': {
    dateColumn: null,
    defaultSort: 'usage_percent_of_limit',
    sortableColumns: ['participant_name', 'plan_name', 'scope', 'unit', 'entitlement_limit', 'used_quantity', 'remaining', 'usage_percent_of_limit', 'overburn_risk'],
  },
  'affiliate-performance': {
    dateColumn: 'last_credit_earned_at',
    defaultSort: 'outstanding_credit_liability_cents',
    sortableColumns: ['referrer_name', 'total_referral_count', 'active_referral_count', 'credits_earned_cents', 'credits_applied_cents', 'outstanding_credit_liability_cents', 'last_credit_earned_at'],
  },
  'data-hygiene': {
    dateColumn: 'created_at',
    defaultSort: 'hygiene_issue_score',
    sortableColumns: ['full_name', 'created_at', 'potential_duplicate_group_size', 'account_member_count', 'has_waiver_without_account_link', 'has_no_account_link', 'missing_email', 'missing_phone', 'hygiene_issue_score'],
  },
});

export function registerAdminReportingRoutes(router, { supabase }) {
  router.get('/finance/monthly-summary', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const monthRaw = String(req.query.month || '').trim();
      let monthStart = null;
      if (monthRaw) {
        if (!/^\d{4}-\d{2}$/.test(monthRaw)) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_month_format',
            expected: 'YYYY-MM',
          });
        }
        monthStart = `${monthRaw}-01`;
      }
      if (!monthStart) {
        const now = new Date();
        monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
      }

      const monthStartDate = new Date(`${monthStart}T00:00:00.000Z`);
      const nextMonthStart = new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 1));
      const monthEnd = new Date(Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth(), 0));
      const toIsoDate = (d) => d.toISOString().slice(0, 10);
      const monthEndIso = toIsoDate(monthEnd);

      const { data: revRow, error: revErr } = await supabase
        .from('view_analytics_revenue_waterfall_monthly')
        .select('month_start, net_cash_collected_cents')
        .eq('month_start', monthStart)
        .limit(1)
        .maybeSingle();
      if (revErr) {
        console.error('finance monthly summary revenue select', revErr);
        return res.status(400).json({ ok: false, error: revErr.message });
      }

      const { data: expenseRows, error: expenseErr } = await supabase
        .from('operating_expenses')
        .select('amount_cents')
        .gte('expense_date', monthStart)
        .lte('expense_date', monthEndIso);
      if (expenseErr) {
        console.error('finance monthly summary expense select', expenseErr);
        return res.status(400).json({ ok: false, error: expenseErr.message });
      }

      const revenue = Number(revRow?.net_cash_collected_cents || 0);
      const expenses = (expenseRows || []).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
      const operatingDelta = revenue - expenses;
      const deficitToCover = Math.max(0, expenses - revenue);
      const ownerSubsidy = 0;

      return res.json({
        ok: true,
        summary: {
          month: monthStart.slice(0, 7),
          month_start: monthStart,
          month_end: monthEndIso,
          revenue_cents: revenue,
          expenses_cents: expenses,
          operating_delta_cents: operatingDelta,
          deficit_to_cover_cents: deficitToCover,
          owner_subsidy_cents: ownerSubsidy,
        },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/reporting/summary/primary-kpis', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const monthRaw = String(req.query.month || '').trim();
      let monthStart = null;
      if (monthRaw) {
        if (!/^\d{4}-\d{2}$/.test(monthRaw)) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_month_format',
            expected: 'YYYY-MM',
          });
        }
        monthStart = `${monthRaw}-01`;
      }
      if (!monthStart) {
        const now = new Date();
        monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
      }

      const { data, error } = await supabase
        .from('view_analytics_primary_kpis_monthly')
        .select('*')
        .eq('month_start', monthStart)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('primary kpi summary select', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      const monthStartDate = new Date(`${monthStart}T00:00:00.000Z`);
      const monthEndDate = new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 0));
      const formatDate = (d) => d.toISOString().slice(0, 10);
      const base = {
        month_start: monthStart,
        month_end: formatDate(monthEndDate),
        expected_revenue_open_due_cents: 0,
        actual_revenue_net_cash_cents: 0,
        total_visitors_present_checkins: 0,
        current_monthly_members_active_count: 0,
      };
      const row = data ? { ...base, ...data } : base;

      return res.json({ ok: true, kpis: row });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/reporting/views/:slug', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const slug = String(req.params.slug || '').toLowerCase();
      const viewName = REPORTING_VIEWS[slug];
      const cfg = REPORTING_VIEW_CONFIG[slug];
      if (!viewName) {
        return res.status(400).json({
          ok: false,
          error: 'unknown_view',
          allowed: Object.keys(REPORTING_VIEWS),
        });
      }
      let limit = Number.parseInt(String(req.query.limit || ''), 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      limit = Math.min(limit, MAX_LIMIT);
      let offset = Number.parseInt(String(req.query.offset || ''), 10);
      if (!Number.isFinite(offset) || offset < 0) offset = 0;
      offset = Math.min(offset, MAX_OFFSET);

      const sortRaw = String(req.query.sort || '').trim();
      const orderRaw = String(req.query.order || '').trim().toLowerCase();
      let order = null;
      if (orderRaw === 'asc' || orderRaw === 'desc') {
        order = orderRaw;
      }

      const sort = sortRaw || cfg?.defaultSort || null;
      if (sort && !cfg?.sortableColumns?.includes(sort)) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_sort_column',
          allowedSort: cfg?.sortableColumns ?? [],
        });
      }
      if (orderRaw && !order) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_order',
          allowedOrder: ['asc', 'desc'],
        });
      }

      const startRaw = String(req.query.start || '').trim();
      const endRaw = String(req.query.end || '').trim();
      const hasDateFilter = Boolean(startRaw || endRaw);
      if (hasDateFilter && !cfg?.dateColumn) {
        return res.status(400).json({
          ok: false,
          error: 'date_filter_not_supported_for_view',
          slug,
        });
      }
      const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (startRaw && !isIsoDate(startRaw)) {
        return res.status(400).json({ ok: false, error: 'invalid_start_date_format' });
      }
      if (endRaw && !isIsoDate(endRaw)) {
        return res.status(400).json({ ok: false, error: 'invalid_end_date_format' });
      }
      if (startRaw && endRaw && startRaw > endRaw) {
        return res.status(400).json({ ok: false, error: 'invalid_date_range' });
      }

      let query = supabase.from(viewName).select('*');
      if (startRaw) query = query.gte(cfg.dateColumn, startRaw);
      if (endRaw) query = query.lte(cfg.dateColumn, endRaw);
      const appliedFilters = {};
      for (const [filterKey, filterCfg] of Object.entries(cfg?.filters ?? {})) {
        const raw = String(req.query[filterKey] || '').trim();
        if (!raw) continue;
        const value = parseNonNegativeInt(raw);
        if (value === null) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_filter_value',
            filter: filterKey,
            expected: 'non_negative_integer',
          });
        }
        if (filterCfg.op === 'lte') query = query.lte(filterCfg.column, value);
        if (filterCfg.op === 'gte') query = query.gte(filterCfg.column, value);
        appliedFilters[filterKey] = value;
      }
      if (sort) query = query.order(sort, { ascending: order === 'asc' });
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) {
        console.error('reporting view select', viewName, error);
        return res.status(400).json({ ok: false, error: error.message, view: viewName });
      }
      const responseOrder = order || (sort ? 'desc' : null);
      return res.json({
        ok: true,
        slug,
        view: viewName,
        limit,
        offset,
        sort,
        order: responseOrder,
        start: startRaw || null,
        end: endRaw || null,
        filters: appliedFilters,
        rowCount: Array.isArray(data) ? data.length : 0,
        rows: data ?? [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
