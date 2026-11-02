function notImplemented(_req, res) {
  return res.status(501).json({ ok: false, error: 'not_implemented' });
}

/**
 * Member booking endpoints (stubbed). Bearer auth will be enforced in A4.
 * @param {import('express').Router} router
 */
export function registerMemberBookingRoutes(router) {
  router.get('/bookings', notImplemented);
  router.post('/bookings', notImplemented);
  router.delete('/bookings/:bookingId', notImplemented);
}

