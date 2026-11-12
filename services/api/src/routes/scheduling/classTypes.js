function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Admin scheduling-v2 class type endpoints (stubbed).
 * Parent router is mounted under `/api/admin` and already runs admin auth + RBAC.
 * @param {import('express').Router} router
 */
export function registerAdminSchedulingV2ClassTypeRoutes(router) {
  router.get('/class-types', notImplemented);
  router.post('/class-types', notImplemented);
  router.get('/class-types/:classTypeId', notImplemented);
  router.patch('/class-types/:classTypeId', notImplemented);
}

