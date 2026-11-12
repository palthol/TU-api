function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Calendar read endpoints (stubbed).
 * @param {import('express').Router} router
 */
export function registerCalendarSessionRoutes(router) {
  router.get('/sessions', notImplemented);
  router.get('/sessions/:sessionId', notImplemented);
}

