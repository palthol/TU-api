import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from './index.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  LEGACY_ADMIN_SESSION_COOKIE_NAME,
  encryptAdminSession,
} from '../../lib/adminSession.js';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'singh@example.com';
const SESSION_SECRET = 'x'.repeat(32);

function baseEnv(overrides = {}) {
  return {
    SESSION_SECRET,
    ADMIN_EMAIL,
    ADMIN_USER_ID,
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test',
    ADMIN_ALLOWED_ORIGINS: 'https://admin.templeunderground.com',
    ...overrides,
  };
}

function confirmedUser(overrides = {}) {
  return {
    id: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockClient({ signInWithPassword, signOut } = {}) {
  return {
    auth: {
      signInWithPassword:
        signInWithPassword ||
        vi.fn(async () => ({
          data: { user: confirmedUser(), session: { user: confirmedUser() } },
          error: null,
        })),
      signOut: signOut || vi.fn(async () => ({ error: null })),
    },
  };
}

function createApp({ env, createSupabaseAuthClient, supabaseAuthClient }) {
  const app = express();
  app.set('trust proxy', 1);
  registerAuthRoutes(app, {
    env,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    createSupabaseAuthClient:
      createSupabaseAuthClient ||
      (supabaseAuthClient ? () => supabaseAuthClient : undefined),
  });
  return app;
}

function cookieHeaderFromResponse(res, name = ADMIN_SESSION_COOKIE_NAME) {
  const headers = res.headers['set-cookie'] || [];
  const match = headers.find((header) => String(header).startsWith(`${name}=`));
  return match ? String(match).split(';')[0] : '';
}

function extractCookieValue(res, name = ADMIN_SESSION_COOKIE_NAME) {
  const pair = cookieHeaderFromResponse(res, name);
  const eq = pair.indexOf('=');
  return eq >= 0 ? pair.slice(eq + 1) : '';
}

describe('/api/auth', () => {
  it('login success sets the __Host- cookie and returns {email}', async () => {
    const env = baseEnv();
    const client = mockClient();
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'singh@example.com' });
    expect(res.headers['cache-control']).toMatch(/no-store/i);
    const cookie = String((res.headers['set-cookie'] || []).find((h) => String(h).startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`)) || '');
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/\bMax-Age=604800\b/);
    expect(extractCookieValue(res).split('.')).toHaveLength(5);
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it('accepts mixed-case emails against ADMIN_EMAIL', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({
        data: { user: confirmedUser({ email: 'SINGH@EXAMPLE.COM' }) },
        error: null,
      })),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'Singh@Example.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'singh@example.com' });
  });

  it('login failure returns generic invalid_credentials without user enumeration', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({
        data: null,
        error: { message: 'Invalid login credentials', status: 400 },
      })),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('rejects a non-admin email even when Supabase auth succeeds', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({
        data: { user: confirmedUser({ email: 'someoneelse@example.com' }) },
        error: null,
      })),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('rejects the right email with the wrong user id', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({
        data: { user: confirmedUser({ id: '22222222-2222-4222-8222-222222222222' }) },
        error: null,
      })),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('rejects an unconfirmed email', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({
        data: { user: confirmedUser({ email_confirmed_at: null }) },
        error: null,
      })),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('returns 503 when Supabase throws', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('service_unavailable');
  });

  it('returns 400 JSON for malformed login JSON', async () => {
    const env = baseEnv();
    const app = createApp({ env, supabaseAuthClient: mockClient() });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('returns 429 JSON after repeated failed logins', async () => {
    const env = baseEnv();
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({
        data: null,
        error: { message: 'Invalid login credentials', status: 400 },
      })),
    });
    const app = createApp({ env, supabaseAuthClient: client });
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'wrong' });
    }
    expect(last.status).toBe(429);
    expect(last.body).toEqual({ error: 'rate_limited' });
  });

  it('does not register auth routes when SESSION_SECRET is missing or short', async () => {
    const missing = createApp({ env: baseEnv({ SESSION_SECRET: undefined }), supabaseAuthClient: mockClient() });
    const short = createApp({ env: baseEnv({ SESSION_SECRET: 'too-short' }), supabaseAuthClient: mockClient() });
    const missingRes = await request(missing).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'pw' });
    const shortRes = await request(short).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'pw' });
    expect(missingRes.status).toBe(404);
    expect(shortRes.status).toBe(404);
  });

  it('/me returns 401 without a valid cookie', async () => {
    const app = createApp({ env: baseEnv(), supabaseAuthClient: mockClient() });
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toMatch(/no-store/i);
  });

  it('/me rolls the cookie (re-issues it) when a session is valid', async () => {
    const env = baseEnv();
    const app = createApp({ env, supabaseAuthClient: mockClient() });
    const login = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    const originalToken = extractCookieValue(login);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeaderFromResponse(login));
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ email: 'singh@example.com' });
    expect(extractCookieValue(me)).not.toEqual(originalToken);
  });

  it('rejects duplicate session cookies', async () => {
    const env = baseEnv();
    const token = await encryptAdminSession({ email: ADMIN_EMAIL }, env);
    const app = createApp({ env, supabaseAuthClient: mockClient() });
    const header = `${ADMIN_SESSION_COOKIE_NAME}=${token}; ${ADMIN_SESSION_COOKIE_NAME}=${token}`;
    const res = await request(app).get('/api/auth/me').set('Cookie', header);
    expect(res.status).toBe(401);
  });

  it('logout clears both cookie names and returns 204', async () => {
    const env = baseEnv();
    const app = createApp({ env, supabaseAuthClient: mockClient() });
    const login = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });

    const badOrigin = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeaderFromResponse(login))
      .set('Origin', 'https://evil.test');
    expect(badOrigin.status).toBe(403);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeaderFromResponse(login))
      .set('Origin', 'https://admin.templeunderground.com');
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] || []).map(String).join('\n');
    expect(cleared).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    expect(cleared).toContain(`${LEGACY_ADMIN_SESSION_COOKIE_NAME}=`);
    expect(cleared.toLowerCase()).toContain('expires=');
  });
});
