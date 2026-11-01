function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Admin scheduling-v2 session endpoints (stubbed).
 * Parent router is mounted under `/api/admin` and already runs admin auth + RBAC.
 * @param {import('express').Router} router
 */
export function registerAdminSchedulingV2SessionRoutes(router) {
  router.get('/sessions', notImplemented);
  router.post('/sessions', notImplemented);
  router.get('/sessions/:sessionId', notImplemented);
  router.patch('/sessions/:sessionId', notImplemented);
  router.post('/sessions/:sessionId/cancel', notImplemented);
}

