import express from 'express';
import { registerAdminSchedulingV2ClassTypeRoutes } from './classTypes.js';
import { registerAdminSchedulingV2InstructorRoutes } from './instructors.js';
import { registerAdminSchedulingV2SessionRoutes } from './sessions.js';

/**
 * New scheduling-v2 admin router. Mounted once by the API entrypoint under
 * `/api/admin/scheduling-v2` (auth + RBAC enforced by the parent admin router).
 */
export function createAdminSchedulingV2Router() {
  const router = express.Router();
  registerAdminSchedulingV2ClassTypeRoutes(router);
  registerAdminSchedulingV2InstructorRoutes(router);
  registerAdminSchedulingV2SessionRoutes(router);
  return router;
}

