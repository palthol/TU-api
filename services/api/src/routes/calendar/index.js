import express from 'express';
import { readBearerToken } from './auth.js';
import { registerCalendarClassRoutes } from './classes.js';
import { registerCalendarClassTypeRoutes } from './classTypes.js';
import { registerCalendarOccurrenceRoutes } from './occurrences.js';
import { registerCalendarSessionRoutes } from './sessions.js';
import {
  createPublicPostRateLimiter,
  readCalendarLimitsFromEnv,
} from '../../lib/publicPostGuard.js';

/**
 * Calendar router. Mounted once by the API entrypoint at `/api/calendar`.
 * Occurrence listing and the active class catalog are public (rate-limited).
 * Other surfaces remain stubbed.
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
    const windowMs = rateLimit?.windowMs ?? envLimits.occurrencesWindowMs;
    const max = rateLimit?.max ?? envLimits.occurrencesMax;
    router.use(
      '/occurrences',
      createPublicPostRateLimiter({
        name: 'calendar_occurrences',
        windowMs,
        max,
      }),
    );
    router.use(
      '/classes',
      createPublicPostRateLimiter({
        name: 'calendar_classes',
        windowMs,
        max,
      }),
    );
  }
  registerCalendarOccurrenceRoutes(router, { supabase });
  registerCalendarClassRoutes(router, { supabase });
  return router;
}
