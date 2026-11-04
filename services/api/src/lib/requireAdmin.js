import {
  canonicalAdminPath,
  createSupabaseAuditWriter,
  createSupabaseStaffLookup,
  adminSessionOwnerActor,
  legacyOwnerActor,
  queuePrivilegedWriteAudit,
  isMutatingMethod,
  roleAllowsRequest,
  safeEqualString,
} from './staffAuth.js';
import { readAdminEmailFromEnv, readAdminSessionFromRequest } from './adminSession.js';
import { isOriginAllowed, parseAllowedOriginsEnv } from './allowedOrigins.js';

function configuredAdminKey() {
  const key = process.env.ADMIN_API_KEY;
  return typeof key === 'string' && key.length ? key : '';
}

/**
 * Resolve the caller to a staff actor. Shared ADMIN_API_KEY is owner compatibility.
 * @param {{ lookupStaff?: (key: string) => Promise<object | null>, writeAudit?: Function }} [options]
 */
export function createRequireAdmin(options = {}) {
  const lookupStaff = options.lookupStaff;
  const writeAudit = options.writeAudit;
  const enforceRoles = options.enforceRoles !== false;

  return async function requireAdmin(req, res, next) {
    try {
      const presented = req.header('x-admin-key');
      const hasKeyHeader = typeof presented === 'string' && presented.length;

      let staff = null;
      if (hasKeyHeader) {
        const sharedKey = configuredAdminKey();
        if (sharedKey && safeEqualString(presented, sharedKey)) {
          staff = legacyOwnerActor();
        } else if (typeof lookupStaff === 'function') {
          staff = await lookupStaff(presented);
        }
      } else {
        const adminEmail = readAdminEmailFromEnv(process.env);
        const session = await readAdminSessionFromRequest(req, process.env);
        if (adminEmail.ok && session && String(session.email || '').toLowerCase() === String(adminEmail.email).trim().toLowerCase()) {
          staff = adminSessionOwnerActor(session.email);
          if (isMutatingMethod(req.method)) {
            const origin = req.header('origin');
            const allowedOrigins = parseAllowedOriginsEnv(process.env.ALLOWED_ORIGIN);
            if (!isOriginAllowed(origin, allowedOrigins)) {
              return res.status(403).json({ ok: false, error: 'csrf_failed' });
            }
          }
        }
      }

      if (!staff) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }

      req.staff = staff;

      if (enforceRoles && !roleAllowsRequest(staff.role, req.method, canonicalAdminPath(req))) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      queuePrivilegedWriteAudit(req, staff, writeAudit);
      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('admin.auth.error', { message });
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
}

/**
 * Env-key gate used by route tests. Production wiring uses createRequireAdmin
 * with a staff-table lookup so personal keys work after migration 20260914185843.
 */
export const requireAdmin = createRequireAdmin();

export function createRequireAdminFromSupabase(supabase) {
  return createRequireAdmin({
    lookupStaff: createSupabaseStaffLookup(supabase),
    writeAudit: createSupabaseAuditWriter(supabase),
  });
}
