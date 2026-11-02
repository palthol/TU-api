function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Calendar discovery endpoints (stubbed).
 * @param {import('express').Router} router
 */
export function registerCalendarClassTypeRoutes(router) {
  router.get('/class-types', notImplemented);
}

