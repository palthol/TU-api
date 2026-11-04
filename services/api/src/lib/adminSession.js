import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

export const ADMIN_SESSION_COOKIE_NAME = '__Host-tu_admin_session';
export const LEGACY_ADMIN_SESSION_COOKIE_NAME = 'tu_admin_session';

export const ADMIN_SESSION_IDLE_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const ADMIN_SESSION_CLOCK_SKEW_SECONDS = 60;

export const ADMIN_SESSION_ISSUER = 'tu-api';
export const ADMIN_SESSION_AUDIENCE = 'tu-admin';

export function readSessionSecretFromEnv(env = process.env) {
  const raw = typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET : '';
  const secret = raw.trim();
  if (!secret) return { ok: false, reason: 'missing' };
  if (secret.length < 32) return { ok: false, reason: 'too_short' };
  return { ok: true, secret };
}

export function readPreviousSessionSecretFromEnv(env = process.env) {
  const raw = typeof env.SESSION_SECRET_PREVIOUS === 'string' ? env.SESSION_SECRET_PREVIOUS : '';
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

export function readSessionsValidAfterFromEnv(env = process.env) {
  const raw = typeof env.SESSIONS_VALID_AFTER === 'string' ? env.SESSIONS_VALID_AFTER : '';
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) return null;
  return Math.floor(parsedMs / 1000);
}

export function adminSessionCookieOptions(env = process.env) {
  const maxAgeMs = ADMIN_SESSION_IDLE_WINDOW_SECONDS * 1000;
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export async function encryptAdminSession(
  { email, authTimeSec },
  env = process.env,
  nowMs = Date.now(),
) {
  const secretResult = readSessionSecretFromEnv(env);
  if (!secretResult.ok) {
    const detail = secretResult.reason === 'too_short' ? 'too short' : 'missing';
    throw new Error(`SESSION_SECRET ${detail}; must be at least 32 chars`);
  }
  const key = deriveJweKeyFromSecret(secretResult.secret);

  const nowSec = Math.floor(nowMs / 1000);
  const authTime = typeof authTimeSec === 'number' && Number.isFinite(authTimeSec) ? authTimeSec : nowSec;
  const iat = nowSec;

  const absoluteExp = authTime + ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS;
  const idleExp = iat + ADMIN_SESSION_IDLE_WINDOW_SECONDS;
  const exp = Math.min(absoluteExp, idleExp);
  if (exp <= iat) {
    throw new Error('session_expired');
  }

  return await new EncryptJWT({ email, auth_time: authTime })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(ADMIN_SESSION_ISSUER)
    .setAudience(ADMIN_SESSION_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .encrypt(key);
}

async function decryptWithKey(token, key, nowSec) {
  const { payload, protectedHeader } = await jwtDecrypt(token, key, {
    issuer: ADMIN_SESSION_ISSUER,
    audience: ADMIN_SESSION_AUDIENCE,
    clockTolerance: ADMIN_SESSION_CLOCK_SKEW_SECONDS,
    maxTokenAge: ADMIN_SESSION_IDLE_WINDOW_SECONDS,
    currentDate: new Date(nowSec * 1000),
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
    requiredClaims: ['email', 'auth_time'],
  });

  if (protectedHeader?.alg !== 'dir' || protectedHeader?.enc !== 'A256GCM') return null;

  const email = typeof payload.email === 'string' ? payload.email : '';
  const iat = typeof payload.iat === 'number' ? payload.iat : null;
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : null;
  if (!email || !iat || !exp || !authTime) return null;
  if (iat > nowSec + ADMIN_SESSION_CLOCK_SKEW_SECONDS) return null;
  if (authTime > nowSec + ADMIN_SESSION_CLOCK_SKEW_SECONDS) return null;
  if (nowSec - authTime > ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS) return null;
  return { email, iat, exp, authTime };
}

export async function decryptAdminSession(token, env = process.env, nowMs = Date.now()) {
  const secretResult = readSessionSecretFromEnv(env);
  if (!secretResult.ok) return null;
  if (typeof token !== 'string' || !token.length) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const validAfter = readSessionsValidAfterFromEnv(env);

  try {
    const keys = [];
    keys.push(deriveJweKeyFromSecret(secretResult.secret));
    const previous = readPreviousSessionSecretFromEnv(env);
    if (previous.ok) keys.push(deriveJweKeyFromSecret(previous.secret));

    for (const key of keys) {
      try {
        const session = await decryptWithKey(token, key, nowSec);
        if (!session) continue;
        if (validAfter != null && session.authTime < validAfter) return null;
        return session;
      } catch {
        // try next key
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function readCookieValueStrict(cookieHeader, cookieName) {
  const header = typeof cookieHeader === 'string' ? cookieHeader : '';
  if (!header) return { ok: false, reason: 'missing', value: null };
  let value = null;
  let count = 0;
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== cookieName) continue;
    count += 1;
    value = trimmed.slice(eq + 1);
  }
  if (count === 0) return { ok: false, reason: 'missing', value: null };
  if (count > 1) return { ok: false, reason: 'duplicate', value: null };
  if (!value) return { ok: false, reason: 'missing', value: null };
  return { ok: true, reason: null, value };
}

export async function readAdminSessionFromRequest(req, env = process.env, nowMs = Date.now()) {
  const cookieHeader = req?.headers?.cookie;
  const token = readCookieValueStrict(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
  if (!token.ok && token.reason === 'duplicate') return { ok: false, reason: 'duplicate_cookie', session: null };
  if (!token.ok) return { ok: false, reason: 'missing_cookie', session: null };
  const session = await decryptAdminSession(token.value, env, nowMs);
  if (!session) return { ok: false, reason: 'invalid_cookie', session: null };
  return { ok: true, reason: null, session };
}

export async function setAdminSessionCookie(
  res,
  { email, authTimeSec },
  env = process.env,
  nowMs = Date.now(),
) {
  const token = await encryptAdminSession({ email, authTimeSec }, env, nowMs);
  res.cookie(ADMIN_SESSION_COOKIE_NAME, token, adminSessionCookieOptions(env));
  return token;
}

export function clearAdminSessionCookie(res, env = process.env) {
  const options = adminSessionCookieOptions(env);
  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
    path: options.path,
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  });
}

export function clearLegacyAdminSessionCookie(res) {
  res.clearCookie(LEGACY_ADMIN_SESSION_COOKIE_NAME, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  });
}

