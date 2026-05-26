import { queryReportingView } from '../../lib/reportingViewQuery.js';

/**
 * Waiver viewer proxy routes.
 * These replace browser-side x-admin-key usage for the standalone viewer app.
 *
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */
export function registerViewerWaiverRoutes(router, { supabase }) {
  router.get('/waiver-documents', async (req, res) => {
    try {
      const result = await queryReportingView(supabase, 'waiver-documents', req.query);
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error('viewer.waiver-documents failed', error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
