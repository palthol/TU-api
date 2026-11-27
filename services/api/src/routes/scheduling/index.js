import express from 'express';
import { registerAdminSchedulingV2ClassRoutes } from './classes.js';
import { registerAdminSchedulingV2ClassTypeRoutes } from './classTypes.js';
import { registerAdminSchedulingV2InstructorRoutes } from './instructors.js';
import { registerAdminSchedulingV2BookingRoutes } from './bookings.js';
import { registerAdminSchedulingV2SessionContentRoutes } from './sessionContent.js';
import { registerAdminSchedulingV2SessionRoutes } from './sessions.js';

/**
 * New scheduling-v2 admin router. Mounted once by the API entrypoint under
 * `/api/admin/scheduling-v2` (auth + RBAC enforced by the parent admin router).
 * @param {{ supabase?: import('@supabase/supabase-js').SupabaseClient | null }} [ctx]
 */
export function createAdminSchedulingV2Router({ supabase } = {}) {
  const router = express.Router();
  registerAdminSchedulingV2ClassTypeRoutes(router);
  registerAdminSchedulingV2InstructorRoutes(router);
  registerAdminSchedulingV2ClassRoutes(router, { supabase });
  registerAdminSchedulingV2SessionRoutes(router);
  registerAdminSchedulingV2SessionContentRoutes(router, { supabase });
  registerAdminSchedulingV2BookingRoutes(router, { supabase });
  return router;
}

