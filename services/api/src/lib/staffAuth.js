import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const STAFF_ROLES = Object.freeze(['owner', 'front_desk', 'finance']);

export const AUTH_METHOD = Object.freeze({
  STAFF_KEY: 'staff_key',
  LEGACY_SHARED_KEY: 'legacy_shared_key',
  CRON_SECRET: 'cron_secret',
});

const LEGACY_ACTOR_LABEL = 'legacy_shared_key';
const CRON_ACTOR_LABEL = 'cron';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

export function hashStaffKey(plaintext) {
  return createHash('sha256').update(String(plaintext), 'utf8').digest('hex');
}

export function generateStaffKey() {
  return `tu_sk_${randomBytes(32).toString('hex')}`;
}

export function staffKeyPrefix(plaintext) {
  return String(plaintext).slice(0, 12);
}

export function safeEqualString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) {
    const dummy = Buffer.alloc(32);
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function legacyOwnerActor() {
  return {
    id: null,
    email: null,
    displayName: LEGACY_ACTOR_LABEL,
    role: 'owner',
    authMethod: AUTH_METHOD.LEGACY_SHARED_KEY,
    actorLabel: LEGACY_ACTOR_LABEL,
  };
}

export function cronStaffActor() {
  return {
    id: null,
    email: null,
    displayName: CRON_ACTOR_LABEL,
    role: 'system',
    authMethod: AUTH_METHOD.CRON_SECRET,
    actorLabel: CRON_ACTOR_LABEL,
  };
}

export function staffActorFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    authMethod: AUTH_METHOD.STAFF_KEY,
    actorLabel: `staff:${row.id}`,
  };
}

export function publicStaffView(staff) {
  if (!staff) return null;
  return {
    id: staff.id,
    email: staff.email,
    display_name: staff.displayName,
    role: staff.role,
    auth_method: staff.authMethod,
    actor_label: staff.actorLabel,
  };
}

export function isValidStaffEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim() : '';
  if (email.length < 3 || email.length > 320) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email.toLowerCase();
}

/**
 * Path as seen under `/api/admin`, or the original path for non-admin mounts
 * (on-demand PDF).
 */
export function canonicalAdminPath(req) {
  const base = String(req?.baseUrl || '');
  const path = String(req?.path || '');
  const combined = `${base}${path}`.split('?')[0] || '/';
  if (combined === '/api/admin') return '/';
  if (combined.startsWith('/api/admin/')) return combined.slice('/api/admin'.length);
  return combined;
}

/**
 * Roles allowed to perform `method` on `canonicalPath`.
 * GET is open to every active staff role except staff-directory listing.
 */
export function rolesAllowedForRequest(method, canonicalPath) {
  const httpMethod = String(method || 'GET').toUpperCase();
  const path = canonicalPath && canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath || ''}`;

  if (path === '/staff' || path.startsWith('/staff/')) {
    return ['owner'];
  }

  if (httpMethod === 'GET' || httpMethod === 'HEAD' || httpMethod === 'OPTIONS') {
    return [...STAFF_ROLES];
  }

  if (path.startsWith('/participants/merge')) return ['owner'];
  if (path.startsWith('/notifications')) return ['owner'];
  if (path.startsWith('/scheduling')) return ['owner', 'front_desk'];
  if (path.startsWith('/waivers')) return ['owner', 'front_desk'];
  if (path.startsWith('/billing/record-payment')) return ['owner', 'finance', 'front_desk'];
  if (path.startsWith('/billing/external-counterparty')) return ['owner', 'finance', 'front_desk'];
  if (path.startsWith('/billing')) return ['owner', 'finance'];
  if (path.startsWith('/api/waivers')) return [...STAFF_ROLES];
  if (path.startsWith('/auth/')) return [...STAFF_ROLES];
  return ['owner'];
}

export function roleAllowsRequest(role, method, canonicalPath) {
  if (role === 'owner') return true;
  return rolesAllowedForRequest(method, canonicalPath).includes(role);
}

export function isMutatingMethod(method) {
  return MUTATING_METHODS.has(String(method || '').toUpperCase());
}

export function isMissingRelationError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

export function createSupabaseStaffLookup(supabase) {
  return async function lookupStaffByPlaintextKey(plaintextKey) {
    if (!supabase || !plaintextKey) return null;
    const keyHash = hashStaffKey(plaintextKey);
    const { data, error } = await supabase
      .from('staff_users')
      .select('id, email, display_name, role, active')
      .eq('key_hash', keyHash)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    if (!data || data.active === false) return null;
    if (!isStaffRole(data.role)) return null;
    void supabase
      .from('staff_users')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(({ error: updateError }) => {
        if (updateError && !isMissingRelationError(updateError)) {
          console.error('staff.last_used.update', { message: updateError.message });
        }
      });
    return staffActorFromRow(data);
  };
}

export function createSupabaseAuditWriter(supabase) {
  return async function writeStaffAudit(event) {
    if (!supabase) return;
    const { error } = await supabase.from('staff_audit_events').insert({
      staff_user_id: event.staffUserId,
      actor_label: event.actorLabel,
      role: event.role,
      auth_method: event.authMethod,
      http_method: event.httpMethod,
      request_path: event.requestPath,
      payload_meta: event.payloadMeta || {},
    });
    if (error && !isMissingRelationError(error)) {
      console.error('staff.audit.insert', { message: error.message });
    }
  };
}

export function queuePrivilegedWriteAudit(req, staff, writeAudit) {
  if (!writeAudit || !staff || !isMutatingMethod(req.method)) return;
  const requestPath = canonicalAdminPath(req);
  void Promise.resolve(
    writeAudit({
      staffUserId: staff.id,
      actorLabel: staff.actorLabel,
      role: staff.role,
      authMethod: staff.authMethod,
      httpMethod: String(req.method || '').toUpperCase(),
      requestPath,
      payloadMeta: { auth_method: staff.authMethod },
    }),
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('staff.audit.write', { message });
  });
}
