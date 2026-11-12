import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

import { registerAuthRoutes } from './index.js';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'singh@example.com';
const SESSION_SECRET = 'y'.repeat(32);

function baseEnv(overrides = {}) {
  return {
    SESSION_SECRET,
    ADMIN_EMAIL,
    ADMIN_USER_ID,
    SUPABASE_URL: 'https://supabase.test',
    ADMIN_ALLOWED_ORIGINS: 'https://admin.templeunderground.com',
    ...overrides,
  };
}

beforeEach(() => {
  createClient.mockReset();
  createClient.mockImplementation(() => ({
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: { user: null },
        error: { message: 'Invalid login credentials', status: 400 },
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  }));
});

async function login(env, options = {}) {
  const app = express();
  app.set('trust proxy', 1);
  registerAuthRoutes(app, { env, ...options });
  await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'pw' });
}

describe('admin login Supabase key', () => {
  it('passes SUPABASE_PUBLISHABLE_KEY to Supabase Auth when both names are set', async () => {
    await login(baseEnv({
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_preferred',
      SUPABASE_ANON_KEY: 'anon-legacy',
    }));
    expect(createClient).toHaveBeenCalledWith(
      'https://supabase.test',
      'sb_publishable_preferred',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
    );
  });

  it('passes SUPABASE_ANON_KEY when the publishable name is blank', async () => {
    await login(baseEnv({
      SUPABASE_PUBLISHABLE_KEY: ' ',
      SUPABASE_ANON_KEY: 'anon-legacy',
    }));
    expect(createClient).toHaveBeenCalledWith(
      'https://supabase.test',
      'anon-legacy',
      expect.any(Object),
    );
  });

  it('lets an explicit supabaseAnonKey override env', async () => {
    await login(
      baseEnv({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_env' }),
      { supabaseAnonKey: 'injected-key' },
    );
    expect(createClient).toHaveBeenCalledWith(
      'https://supabase.test',
      'injected-key',
      expect.any(Object),
    );
  });
});
