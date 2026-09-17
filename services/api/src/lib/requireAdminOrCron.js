import { cronStaffActor, queuePrivilegedWriteAudit, safeEqualString } from './staffAuth.js';

/**
 * Allows admin key (operators) or cron secret (scheduled jobs) when CRON_SECRET is set.
 * If CRON_SECRET is unset, only x-admin-key works (unchanged dev behavior).
 */
export function createRequireAdminOrCron(requireAdmin, options = {}) {
  const writeAudit = options.writeAudit;
  return function requireAdminOrCron(req, res, next) {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = req.header('x-cron-secret');
    if (
      typeof cronSecret === 'string' &&
      cronSecret.length &&
      typeof headerSecret === 'string' &&
      headerSecret.length &&
      safeEqualString(headerSecret, cronSecret)
    ) {
      req.staff = cronStaffActor();
      queuePrivilegedWriteAudit(req, req.staff, writeAudit);
      return next();
    }
    return requireAdmin(req, res, next);
  };
}
