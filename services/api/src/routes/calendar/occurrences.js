import { expandClassOccurrences } from '../../lib/classOccurrences.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';
import { attachPublicSessionContent, readPublicSessionContentRows } from '../../lib/sessionContent.js';
import { CLASS_COLUMNS } from '../scheduling/classes.js';

/**
 * Public calendar of upcoming class occurrences (no booking).
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerCalendarOccurrenceRoutes(router, { supabase } = {}) {
  router.get('/occurrences', async (_req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const { data, error } = await supabase
        .from('classes')
        .select(CLASS_COLUMNS)
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) return sendDatabaseError(res, error, { context: 'calendar.occurrences.list' });

      const { data: contentRows, error: contentError } = await supabase
        .from('session_content')
        .select('notes, video_url, visibility, sessions!inner(starts_at, session_label, cancelled_at)')
        .eq('visibility', 'public');
      if (contentError) {
        return sendDatabaseError(res, contentError, { context: 'calendar.occurrences.content' });
      }

      const expanded = expandClassOccurrences(data ?? [], { now: new Date() });
      return res.json({
        ok: true,
        timezone: expanded.timezone,
        window: {
          start_date: expanded.startDate,
          end_date: expanded.endDate,
          days: expanded.days,
        },
        occurrences: attachPublicSessionContent(expanded.occurrences, readPublicSessionContentRows(contentRows)),
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
