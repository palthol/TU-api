function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Member identity endpoints (stubbed). Bearer auth will be enforced in A4.
 * @param {import('express').Router} router
 */
export function registerMemberMeRoutes(router) {
  router.get('/me', notImplemented);
}

