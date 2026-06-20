import { queryReportingView } from '../../lib/reportingViewQuery.js';

export { REPORTING_VIEWS, REPORTING_VIEW_CONFIG } from './reportingViews.js';

/**
 * Read-only reporting: SELECT from whitelisted views (service role bypasses RLS).
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */

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
      const slug = String(req.params.slug || '').toLowerCase();
      const result = await queryReportingView(supabase, slug, req.query);
      return res.status(result.status).json(result.body);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
