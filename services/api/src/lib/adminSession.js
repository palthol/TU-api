import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

export const ADMIN_SESSION_COOKIE_NAME = 'tu_admin_session';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 45 * 24 * 60 * 60;

export function readSessionSecretFromEnv(env = process.env) {
  const raw = typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET : '';
  const secret = raw.trim();
  if (!secret) return { ok: false, reason: 'missing' };
  if (secret.length < 32) return { ok: false, reason: 'too_short' };
  return { ok: true, secret };
}

export function readAdminEmailFromEnv(env = process.env) {
  const raw = typeof env.ADMIN_EMAIL === 'string' ? env.ADMIN_EMAIL : '';
  const email = raw.trim();
  if (!email) return { ok: false, reason: 'missing' };
  return { ok: true, email };
}

function deriveJweKeyFromSecret(secret) {
  // Derive a stable 32-byte key from any >=32 char secret; avoids imposing base64 formatting.
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function readCookieDomainFromEnv(env = process.env) {
  const raw = typeof env.COOKIE_DOMAIN === 'string' ? env.COOKIE_DOMAIN : '';
  const domain = raw.trim();
  return domain ? domain : null;
}

export function adminSessionCookieOptions(env = process.env) {
  const domain = readCookieDomainFromEnv(env);
  const maxAgeMs = ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
    ...(domain ? { domain } : null),
  };
}

export async function encryptAdminSession({ email }, env = process.env, nowMs = Date.now()) {
  const secretResult = readSessionSecretFromEnv(env);
  if (!secretResult.ok) {
    const detail = secretResult.reason === 'too_short' ? 'too short' : 'missing';
    throw new Error(`SESSION_SECRET ${detail}; must be at least 32 chars`);
  }
  const key = deriveJweKeyFromSecret(secretResult.secret);

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ADMIN_SESSION_MAX_AGE_SECONDS;

  return await new EncryptJWT({ email })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .encrypt(key);
}

export async function decryptAdminSession(token, env = process.env) {
  const secretResult = readSessionSecretFromEnv(env);
  if (!secretResult.ok) return null;
  if (typeof token !== 'string' || !token.length) return null;
  const key = deriveJweKeyFromSecret(secretResult.secret);

  try {
    const { payload } = await jwtDecrypt(token, key, {});
    const email = typeof payload.email === 'string' ? payload.email : '';
    const iat = typeof payload.iat === 'number' ? payload.iat : null;
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    if (!email || !iat || !exp) return null;
    return { email, iat, exp };
  } catch {
    return null;
  }
}

export function readCookieValue(cookieHeader, cookieName) {
  const header = typeof cookieHeader === 'string' ? cookieHeader : '';
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== cookieName) continue;
    return trimmed.slice(eq + 1);
  }
  return null;
}

export async function readAdminSessionFromRequest(req, env = process.env) {
  const cookieHeader = req?.headers?.cookie;
  const token = readCookieValue(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
  return await decryptAdminSession(token, env);
}

export async function setAdminSessionCookie(res, { email }, env = process.env, nowMs = Date.now()) {
  const token = await encryptAdminSession({ email }, env, nowMs);
  res.cookie(ADMIN_SESSION_COOKIE_NAME, token, adminSessionCookieOptions(env));
  return token;
}

export function clearAdminSessionCookie(res, env = process.env) {
  const options = adminSessionCookieOptions(env);
  // res.clearCookie needs matching path/domain to reliably clear.
  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
    path: options.path,
    ...(options.domain ? { domain: options.domain } : null),
  });
}

