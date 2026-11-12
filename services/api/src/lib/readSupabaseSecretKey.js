/**
 * Server-side Supabase secret (sb_secret_ key, or a legacy service_role JWT).
 *
 * SUPABASE_SECRET_KEY wins. SUPABASE_SERVICE_ROLE_KEY is used only when the
 * new name is unset or blank. A set-but-wrong value does not fall back.
 */
export function readSupabaseSecretKey(env = process.env) {
  const preferred = nonEmptyString(env?.SUPABASE_SECRET_KEY);
  if (preferred) return preferred;
  return nonEmptyString(env?.SUPABASE_SERVICE_ROLE_KEY);
}

function nonEmptyString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}
