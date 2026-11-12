import { createHash } from 'node:crypto';
import { EncryptJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  ADMIN_SESSION_AUDIENCE,
  ADMIN_SESSION_IDLE_WINDOW_SECONDS,
  ADMIN_SESSION_ISSUER,
  decryptAdminSession,
  encryptAdminSession,
  readCookieValueStrict,
  readSessionSecretFromEnv,
} from './adminSession.js';

const SECRET = 'current-session-secret-value-32ch';
const PREVIOUS = 'previous-session-secret-value-32';
const EMAIL = 'singh@example.com';

function keyFrom(secret) {
  return createHash('sha256').update(secret, 'utf8').digest();
}

async function mint({
  secret = SECRET,
  email = EMAIL,
  iat,
  exp,
  authTime,
  iss = ADMIN_SESSION_ISSUER,
  aud = ADMIN_SESSION_AUDIENCE,
}) {
  return new EncryptJWT({ email, auth_time: authTime })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .encrypt(keyFrom(secret));
}

describe('admin session crypto', () => {
  it('treats a missing or short SESSION_SECRET as unusable', () => {
    expect(readSessionSecretFromEnv({}).ok).toBe(false);
    expect(readSessionSecretFromEnv({ SESSION_SECRET: 'short' }).ok).toBe(false);
    expect(readSessionSecretFromEnv({ SESSION_SECRET: SECRET }).ok).toBe(true);
  });

  it('decrypts a token minted with SESSION_SECRET_PREVIOUS and issues only verify against current+previous', async () => {
    const token = await encryptAdminSession({ email: EMAIL }, { SESSION_SECRET: PREVIOUS });
    const session = await decryptAdminSession(token, {
      SESSION_SECRET: SECRET,
      SESSION_SECRET_PREVIOUS: PREVIOUS,
    });
    expect(session?.email).toBe(EMAIL);
    expect(typeof session?.authTime).toBe('number');
  });

  it('rejects a token minted with a different secret', async () => {
    const token = await encryptAdminSession({ email: EMAIL }, { SESSION_SECRET: PREVIOUS });
    const session = await decryptAdminSession(token, { SESSION_SECRET: SECRET });
    expect(session).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await encryptAdminSession({ email: EMAIL }, { SESSION_SECRET: SECRET });
    const tampered = `${token.slice(0, -4)}AAAA`;
    const session = await decryptAdminSession(tampered, { SESSION_SECRET: SECRET });
    expect(session).toBeNull();
  });

  it('rejects an idle-expired token', async () => {
    const nowMs = Date.now();
    const iat = Math.floor(nowMs / 1000) - ADMIN_SESSION_IDLE_WINDOW_SECONDS - 60;
    const token = await mint({
      iat,
      exp: iat + ADMIN_SESSION_IDLE_WINDOW_SECONDS,
      authTime: iat,
    });
    const session = await decryptAdminSession(token, { SESSION_SECRET: SECRET }, nowMs);
    expect(session).toBeNull();
  });

  it('rejects a token past the 30-day absolute auth_time cap', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const authTime = nowSec - ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS - 120;
    const token = await mint({
      iat: nowSec,
      exp: nowSec + ADMIN_SESSION_IDLE_WINDOW_SECONDS,
      authTime,
    });
    const session = await decryptAdminSession(token, { SESSION_SECRET: SECRET }, nowSec * 1000);
    expect(session).toBeNull();
  });

  it('rejects a token whose auth_time is before SESSIONS_VALID_AFTER', async () => {
    const nowMs = Date.now();
    const token = await encryptAdminSession({ email: EMAIL }, { SESSION_SECRET: SECRET }, nowMs - 60_000);
    const session = await decryptAdminSession(
      token,
      { SESSION_SECRET: SECRET, SESSIONS_VALID_AFTER: new Date(nowMs).toISOString() },
      nowMs,
    );
    expect(session).toBeNull();
  });

  it('accepts a token whose auth_time is after SESSIONS_VALID_AFTER', async () => {
    const nowMs = Date.now();
    const token = await encryptAdminSession({ email: EMAIL }, { SESSION_SECRET: SECRET }, nowMs);
    const session = await decryptAdminSession(
      token,
      {
        SESSION_SECRET: SECRET,
        SESSIONS_VALID_AFTER: new Date(nowMs - 60_000).toISOString(),
      },
      nowMs,
    );
    expect(session?.email).toBe(EMAIL);
  });

  it('rejects a token with a future iat beyond clock skew', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = nowSec + 120;
    const token = await mint({
      iat,
      exp: iat + 60,
      authTime: iat,
    });
    const session = await decryptAdminSession(token, { SESSION_SECRET: SECRET }, nowSec * 1000);
    expect(session).toBeNull();
  });

  it('rejects every session when SESSIONS_VALID_AFTER is set but unparseable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const token = await encryptAdminSession({ email: EMAIL }, { SESSION_SECRET: SECRET });
    const session = await decryptAdminSession(token, {
      SESSION_SECRET: SECRET,
      SESSIONS_VALID_AFTER: 'not-a-timestamp',
    });
    expect(session).toBeNull();
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).toMatch(/SESSIONS_VALID_AFTER/);
    expect(logged).not.toContain(SECRET);
    warn.mockRestore();
  });

  it('rejects duplicate cookies with the session name', () => {
    const header = '__Host-tu_admin_session=aaa; __Host-tu_admin_session=bbb';
    expect(readCookieValueStrict(header, '__Host-tu_admin_session')).toEqual({
      ok: false,
      reason: 'duplicate',
      value: null,
    });
  });
});
