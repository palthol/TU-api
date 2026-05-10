const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const parseLimit = (raw) => {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const parseOffset = (raw) => {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

/**
 * Minimal waiver read API for the future admin review UI.
 * All routes assume requireAdmin middleware (x-admin-key).
 */
export function registerAdminWaiverRoutes(router, { supabase }) {
  router.get('/waivers', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const limit = parseLimit(req.query.limit);
      const offset = parseOffset(req.query.offset);
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
        console.error('admin.waivers.list error', error);
        return res.status(400).json({ ok: false, error: error.message });
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
