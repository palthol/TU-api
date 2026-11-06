import express from 'express';
import { readBearerToken } from './auth.js';
import { registerCalendarClassTypeRoutes } from './classTypes.js';
import { registerCalendarOccurrenceRoutes } from './occurrences.js';
import { registerCalendarSessionRoutes } from './sessions.js';
import {
  createPublicPostRateLimiter,
  readCalendarLimitsFromEnv,
} from '../../lib/publicPostGuard.js';

/**
 * Calendar router. Mounted once by the API entrypoint at `/api/calendar`.
 * Occurrence listing is public (rate-limited). Other surfaces remain stubbed.
 * @param {{
 *   supabase?: import('@supabase/supabase-js').SupabaseClient | null,
 *   rateLimit?: { windowMs?: number, max?: number } | false,
 * }} [ctx]
 */
export function createCalendarRouter({ supabase, rateLimit } = {}) {
  const router = express.Router();
  router.use(readBearerToken);
  registerCalendarClassTypeRoutes(router);
  registerCalendarSessionRoutes(router);

  if (rateLimit !== false) {
    const envLimits = readCalendarLimitsFromEnv(process.env);
    router.use(
      '/occurrences',
      createPublicPostRateLimiter({
        name: 'calendar_occurrences',
        windowMs: rateLimit?.windowMs ?? envLimits.occurrencesWindowMs,
        max: rateLimit?.max ?? envLimits.occurrencesMax,
      }),
    );
  }
  registerCalendarOccurrenceRoutes(router, { supabase });
  return router;
}
