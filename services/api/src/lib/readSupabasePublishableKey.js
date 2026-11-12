/**
 * Supabase Auth key for admin password sign-in (sb_publishable_ or legacy anon JWT).
 *
 * SUPABASE_PUBLISHABLE_KEY wins. SUPABASE_ANON_KEY is used only when the new
 * name is unset or blank. A set-but-wrong value does not fall back.
 */
export function readSupabasePublishableKey(env = process.env) {
  const preferred = nonEmptyString(env?.SUPABASE_PUBLISHABLE_KEY);
  if (preferred) return preferred;
  return nonEmptyString(env?.SUPABASE_ANON_KEY);
}

function nonEmptyString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}
