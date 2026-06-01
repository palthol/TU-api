/**
 * Allows admin key (operators) or cron secret (scheduled jobs) when CRON_SECRET is set.
 * If CRON_SECRET is unset, only x-admin-key works (unchanged dev behavior).
 */
export function createRequireAdminOrCron(requireAdmin) {
  return function requireAdminOrCron(req, res, next) {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = req.header('x-cron-secret');
    if (cronSecret && headerSecret && headerSecret === cronSecret) {
      return next();
    }
    return requireAdmin(req, res, next);
  };
}
