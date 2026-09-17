/**
 * Refuse production (and unmarked remote) targets for tu-test seed/cleanup.
 *
 * Production Supabase project `jhxzecxkccqlgyazhsnb` and the Render API hosts
 * from API-OPS-001 are never allowed. There is no override.
 *
 * Local URLs (localhost / 127.0.0.1 / ::1) are allowed by default.
 * Any other host requires TU_TEST_ALLOW_REMOTE=1 (approved non-prod only).
 */

export const PRODUCTION_SUPABASE_PROJECT_REF = 'jhxzecxkccqlgyazhsnb';

export const PRODUCTION_API_HOSTS = Object.freeze([
  'api.templeunderground.com',
  'temple-underground-signup.onrender.com',
]);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

function asUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    try {
      return new URL(`http://${s}`);
    } catch {
      return null;
    }
  }
}

function hostnameOf(raw) {
  const url = asUrl(raw);
  return url ? url.hostname.toLowerCase() : '';
}

export function isProductionSupabaseUrl(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes(PRODUCTION_SUPABASE_PROJECT_REF)) return true;
  const host = hostnameOf(raw);
  // Hosted project URLs are <ref>.supabase.co
  return host === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
}

export function isProductionApiBase(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return false;
  const host = hostnameOf(raw);
  if (PRODUCTION_API_HOSTS.includes(host)) return true;
  return PRODUCTION_API_HOSTS.some((h) => s.includes(h));
}

export function isLocalUrl(raw) {
  const host = hostnameOf(raw);
  return LOCAL_HOSTS.has(host);
}

export function remoteAllowed() {
  return String(process.env.TU_TEST_ALLOW_REMOTE ?? '') === '1';
}

/**
 * @param {{ supabaseUrl?: string, apiBase?: string, label?: string }} opts
 * @returns {string[]} human-readable refusal reasons (empty if ok)
 */
export function productionTargetReasons({ supabaseUrl, apiBase } = {}) {
  const reasons = [];
  if (supabaseUrl && isProductionSupabaseUrl(supabaseUrl)) {
    reasons.push(
      `SUPABASE_URL points at production project ${PRODUCTION_SUPABASE_PROJECT_REF} (out of bounds for VAL tasks).`,
    );
  }
  if (apiBase && isProductionApiBase(apiBase)) {
    reasons.push(
      `API base points at production Render host (${PRODUCTION_API_HOSTS.join(' or ')}). Do not seed or write against it.`,
    );
  }
  if (supabaseUrl && !isProductionSupabaseUrl(supabaseUrl) && !isLocalUrl(supabaseUrl) && !remoteAllowed()) {
    reasons.push(
      'SUPABASE_URL is not local. Use `npm run supabase:start` (http://127.0.0.1:54321) or set TU_TEST_ALLOW_REMOTE=1 for an approved non-production project. Production remains forbidden.',
    );
  }
  if (apiBase && !isProductionApiBase(apiBase) && !isLocalUrl(apiBase) && !remoteAllowed()) {
    reasons.push(
      'API base is not local. Point TU_TEST_API_BASE at http://127.0.0.1:3001 or set TU_TEST_ALLOW_REMOTE=1 for an approved non-production API. Production remains forbidden.',
    );
  }
  return reasons;
}

export function assertNonProductionTargets(opts = {}) {
  const reasons = productionTargetReasons(opts);
  if (reasons.length) {
    const err = new Error(`Refusing tu-test target.\n- ${reasons.join('\n- ')}`);
    err.code = 'TU_TEST_PRODUCTION_TARGET';
    throw err;
  }
}

/**
 * Scan a dotenv-style file for production identifiers without printing values.
 * @param {string} contents
 */
export function envFileLooksLikeProduction(contents) {
  const text = String(contents ?? '');
  if (text.includes(PRODUCTION_SUPABASE_PROJECT_REF)) return true;
  const lower = text.toLowerCase();
  return PRODUCTION_API_HOSTS.some((h) => lower.includes(h));
}
