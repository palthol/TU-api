function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Admin scheduling-v2 instructor endpoints (stubbed).
 * Parent router is mounted under `/api/admin` and already runs admin auth + RBAC.
 * @param {import('express').Router} router
 */
export function registerAdminSchedulingV2InstructorRoutes(router) {
  router.get('/instructors', notImplemented);
  router.post('/instructors', notImplemented);
  router.get('/instructors/:instructorId', notImplemented);
  router.patch('/instructors/:instructorId', notImplemented);
}

