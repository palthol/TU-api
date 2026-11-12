/**
 * Warn at startup if the server Supabase key cannot bypass RLS.
 * sb_secret_ keys are valid. sb_publishable_ keys are not.
 * Legacy JWTs must carry role "service_role" (anon/authenticated will fail RLS).
 */
export function warnIfSupabaseKeyIsNotServiceRole(serviceRoleKey) {
  if (!serviceRoleKey || typeof serviceRoleKey !== 'string') return;
  const key = serviceRoleKey.trim();
  if (!key) return;

  if (key.startsWith('sb_secret_')) return;

  if (key.startsWith('sb_publishable_')) {
    console.warn(
      '\n[Supabase] Server key is an sb_publishable_ key. Expected an sb_secret_ key in SUPABASE_SECRET_KEY, or a service_role JWT.',
    );
    console.warn(
      '[Supabase] Waiver and admin DB writes will fail RLS. Use the secret key, not the publishable/anon key.\n',
    );
    return;
  }

  const parts = key.split('.');
  if (parts.length !== 3) return;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    const role = payload?.role;
    if (role && role !== 'service_role') {
      console.warn(
        '\n[Supabase] Server key JWT has role "%s" (expected "service_role", or use an sb_secret_ key).',
        role,
      );
      console.warn(
        '[Supabase] Waiver and admin DB writes will fail RLS. Set SUPABASE_SECRET_KEY to the sb_secret_ key (not the publishable/anon key).\n',
      );
    }
  } catch {
    /* not a JWT-shaped key */
  }
}
