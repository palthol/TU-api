import { parsePagination } from '../../lib/adminRequestValidation.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';

/**
 * Minimal waiver read API for the future admin review UI.
 * All routes assume requireAdmin middleware (x-admin-key).
 */
export function registerAdminWaiverRoutes(router, { supabase }) {
  router.get('/waivers', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const page = parsePagination(req.query, { maxLimit: 100 });
      if (!page.ok) return res.status(400).json({ ok: false, error: page.error });
      const { limit, offset } = page;
      const { data, error } = await supabase
        .from('view_waiver_documents')
        .select(
          [
            'waiver_id',
            'participant_id',
            'participant_full_name',
            'participant_email',
            'participant_cell_phone',
            'signed_at_utc',
            'audit_created_at',
            'review_confirm_accuracy',
          ].join(', '),
        )
        .order('signed_at_utc', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return sendDatabaseError(res, error, { context: 'admin.waivers.list' });
      }

      return res.json({
        ok: true,
        limit,
        offset,
        rowCount: Array.isArray(data) ? data.length : 0,
        rows: data ?? [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
