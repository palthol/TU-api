import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from './requireAdmin.js';
import { registerAdminSchedulingRoutes } from '../routes/admin/scheduling.js';

const ADMIN_KEY = 'error-hygiene-admin-key';
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_RESPONSE_RE = /error:\s*[A-Za-z_$][\w$]*\??\.message\b/;
const RAW_DB_TEXT_RE =
  /violates (foreign key|unique|check|not-null) constraint|duplicate key value|invalid input syntax for type/i;

function walkJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkJsFiles(full, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    if (entry.name.endsWith('.test.js')) continue;
    out.push(full);
  }
  return out;
}

function createApp(supabase) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(requireAdmin);
  registerAdminSchedulingRoutes(router, { supabase });
  app.use('/api/admin', router);
  return app;
}

function failingInsertClient(error) {
  return {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: async () => ({ data: null, error }),
              };
            },
          };
        },
      };
    },
  };
}

function assertSanitized(res) {
  expect(res.body.ok).toBe(false);
  expect(typeof res.body.error).toBe('string');
  expect(res.body.error).toMatch(/^[a-z][a-z0-9_]{1,80}$/);
  const serialized = JSON.stringify(res.body);
  expect(serialized).not.toMatch(RAW_DB_TEXT_RE);
  expect(serialized).not.toContain('schedule_templates');
  expect(serialized).not.toContain('sessions_schedule_template_id_fkey');
  expect(res.body).not.toHaveProperty('message');
  expect(res.body).not.toHaveProperty('details');
  expect(res.body).not.toHaveProperty('hint');
}

describe('database error hygiene', () => {
  let previousAdminKey;

  beforeEach(() => {
    previousAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    vi.restoreAllMocks();
  });

  it('does not return raw error.message from API source files', () => {
    const helperFile = join(SRC_ROOT, 'lib/exposeSupabaseError.js');
    const offenders = [];
    for (const file of walkJsFiles(SRC_ROOT)) {
      if (file === helperFile) continue;
      const source = readFileSync(file, 'utf8');
      if (RAW_RESPONSE_RE.test(source)) offenders.push(file.slice(SRC_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it('returns related_record_not_found for a session FK violation', async () => {
    const supabase = failingInsertClient({
      code: '23503',
      message:
        'insert or update on table "sessions" violates foreign key constraint "sessions_schedule_template_id_fkey"',
      details:
        'Key (schedule_template_id)=(44444444-4444-4444-8444-444444444444) is not present in table "schedule_templates".',
      hint: 'Check schedule_template_id',
    });
    const res = await request(createApp(supabase))
      .post('/api/admin/scheduling/sessions')
      .set('x-admin-key', ADMIN_KEY)
      .send({
        starts_at: '2026-06-01T18:00:00.000Z',
        ends_at: '2026-06-01T19:00:00.000Z',
        schedule_template_id: '44444444-4444-4444-8444-444444444444',
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'related_record_not_found' });
    assertSanitized(res);
  });

  it('returns 409 already_exists for a unique violation', async () => {
    const supabase = failingInsertClient({
      code: '23505',
      message: 'duplicate key value violates unique constraint "schedule_templates_pkey"',
      details: 'Key (id)=(11111111-1111-4111-8111-111111111111) already exists.',
    });
    const res = await request(createApp(supabase))
      .post('/api/admin/scheduling/templates')
      .set('x-admin-key', ADMIN_KEY)
      .send({
        name: 'Kids fundamentals',
        day_of_week: 1,
        start_time: '18:00',
        duration_minutes: 60,
      });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'already_exists' });
    assertSanitized(res);
  });
});
