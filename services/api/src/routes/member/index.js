import express from 'express';
import { readBearerToken } from './auth.js';
import { registerMemberBookingRoutes } from './bookings.js';
import { registerMemberMeRoutes } from './me.js';

/**
 * Member router (stubbed). Mounted once by the API entrypoint at `/api/member`.
 */
export function createMemberRouter() {
  const router = express.Router();
  router.use(readBearerToken);
  registerMemberMeRoutes(router);
  registerMemberBookingRoutes(router);
  return router;
}

