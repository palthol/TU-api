import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';
import { CLASS_COLUMNS } from '../scheduling/classes.js';

/**
 * Public catalog of active classes (no booking, no inactive rows).
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerCalendarClassRoutes(router, { supabase } = {}) {
  router.get('/classes', async (_req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const { data, error } = await supabase
        .from('classes')
        .select(CLASS_COLUMNS)
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true })
        .order('name', { ascending: true });
      if (error) return sendDatabaseError(res, error, { context: 'calendar.classes.list' });

      return res.json({
        ok: true,
        classes: data ?? [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
