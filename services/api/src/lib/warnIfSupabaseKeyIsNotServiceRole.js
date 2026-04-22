/**
 * Warn at startup if SUPABASE_SERVICE_ROLE_KEY is not a service_role JWT.
 * Using the anon key here causes RLS to block inserts (e.g. participants on waiver submit).
 */
export function warnIfSupabaseKeyIsNotServiceRole(serviceRoleKey) {
  if (!serviceRoleKey || typeof serviceRoleKey !== 'string') return;
  const parts = serviceRoleKey.split('.');
  if (parts.length !== 3) return;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    const role = payload?.role;
    if (role && role !== 'service_role') {
      console.warn(
        '\n[Supabase] SUPABASE_SERVICE_ROLE_KEY JWT has role "%s" (expected "service_role").',
        role,
      );
      console.warn(
        '[Supabase] Waiver and admin DB writes will fail RLS. Use Project Settings → API → service_role secret (not anon).\n',
      );
    }
  } catch {
    /* not a JWT-shaped key */
  }
}
