import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from './index.js';

function createApp({ env, supabaseAuthClient }) {
  const app = express();
  registerAuthRoutes(app, {
    env,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    supabaseAuthClient,
  });
  return app;
}

function extractCookieValue(setCookieHeader) {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const raw = String(header || '');
  const first = raw.split(';')[0] || '';
  const eq = first.indexOf('=');
  return eq >= 0 ? first.slice(eq + 1) : '';
}

describe('/api/auth', () => {
  it('login success sets the session cookie and returns {email}', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(32),
      ADMIN_EMAIL: 'singh@example.com',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test',
      COOKIE_DOMAIN: '.templeunderground.com',
      ALLOWED_ORIGIN: 'https://admin.templeunderground.com',
    };

    const signInWithPassword = vi.fn(async () => ({
      data: { user: { email: 'SINGH@EXAMPLE.COM' }, session: { user: { email: 'SINGH@EXAMPLE.COM' } } },
      error: null,
    }));

    const app = createApp({ env, supabaseAuthClient: { auth: { signInWithPassword } } });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'singh@example.com' });
    expect(res.headers['set-cookie']).toBeTruthy();
    const cookie = String(res.headers['set-cookie'][0] || '');
    expect(cookie).toContain('tu_admin_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Domain=.templeunderground.com');
    expect(cookie).toMatch(/\bMax-Age=3888000\b/);

    const token = extractCookieValue(res.headers['set-cookie']);
    expect(token.split('.')).toHaveLength(5);
  });

  it('login failure returns generic invalid_credentials without user enumeration', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(32),
      ADMIN_EMAIL: 'singh@example.com',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test',
    };

    const signInWithPassword = vi.fn(async () => ({
      data: null,
      error: { message: 'Invalid login credentials' },
    }));

    const app = createApp({ env, supabaseAuthClient: { auth: { signInWithPassword } } });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('rejects a non-admin email even when Supabase auth succeeds', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(32),
      ADMIN_EMAIL: 'singh@example.com',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test',
    };

    const signInWithPassword = vi.fn(async () => ({
      data: { user: { email: 'someoneelse@example.com' }, session: { user: { email: 'someoneelse@example.com' } } },
      error: null,
    }));

    const app = createApp({ env, supabaseAuthClient: { auth: { signInWithPassword } } });
    const res = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('/me returns 401 without a valid cookie', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(32),
      ADMIN_EMAIL: 'singh@example.com',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test',
    };
    const app = createApp({ env, supabaseAuthClient: { auth: { signInWithPassword: vi.fn() } } });
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('/me rolls the cookie (re-issues it) when a session is valid', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(32),
      ADMIN_EMAIL: 'singh@example.com',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test',
    };

    const signInWithPassword = vi.fn(async () => ({
      data: { user: { email: 'singh@example.com' }, session: { user: { email: 'singh@example.com' } } },
      error: null,
    }));

    const app = createApp({ env, supabaseAuthClient: { auth: { signInWithPassword } } });
    const login = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    const cookieHeader = String(login.headers['set-cookie'][0]);
    const originalToken = extractCookieValue(login.headers['set-cookie']);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ email: 'singh@example.com' });
    const rolledToken = extractCookieValue(me.headers['set-cookie']);
    expect(rolledToken).not.toEqual(originalToken);
  });

  it('logout clears the cookie and returns 204 (Origin required when cookie is present)', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(32),
      ADMIN_EMAIL: 'singh@example.com',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test',
      ALLOWED_ORIGIN: 'https://admin.templeunderground.com',
    };

    const signInWithPassword = vi.fn(async () => ({
      data: { user: { email: 'singh@example.com' }, session: { user: { email: 'singh@example.com' } } },
      error: null,
    }));

    const app = createApp({ env, supabaseAuthClient: { auth: { signInWithPassword } } });
    const login = await request(app).post('/api/auth/login').send({ email: 'singh@example.com', password: 'pw' });
    const cookieHeader = String(login.headers['set-cookie'][0]);

    const badOrigin = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader).set('Origin', 'https://evil.test');
    expect(badOrigin.status).toBe(403);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader)
      .set('Origin', 'https://admin.templeunderground.com');
    expect(res.status).toBe(204);
    const cleared = String(res.headers['set-cookie'][0] || '');
    expect(cleared).toContain('tu_admin_session=');
    expect(cleared.toLowerCase()).toContain('expires=');
  });
});

