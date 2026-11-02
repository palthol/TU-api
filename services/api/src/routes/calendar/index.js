import express from 'express';
import { readBearerToken } from './auth.js';
import { registerCalendarClassTypeRoutes } from './classTypes.js';
import { registerCalendarSessionRoutes } from './sessions.js';

/**
 * Calendar router (stubbed). Mounted once by the API entrypoint at `/api/calendar`.
 */
export function createCalendarRouter() {
  const router = express.Router();
  router.use(readBearerToken);
  registerCalendarClassTypeRoutes(router);
  registerCalendarSessionRoutes(router);
  return router;
}

