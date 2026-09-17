import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { createRequireAdminOrCron } from '../../lib/requireAdminOrCron.js';
import { registerAdminBillingCronRoutes } from './billing.js';

const ADMIN_KEY = 'test-admin-key-monthly-charges';
const CRON_SECRET = 'test-cron-secret-monthly-charges';
const CHARGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const MIGRATION_0002 = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/0002_business_logic_and_affiliations.sql',
);

function createApp(supabase) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(createRequireAdminOrCron(requireAdmin));
  registerAdminBillingCronRoutes(router, { supabase });
  app.use('/api/admin', router);
  return app;
}

function createSupabase({ rpcResult, rpcImpl } = {}) {
  return {
    from: vi.fn(() => {
      throw new Error('generate-monthly-charges tests must not query tables');
    }),
    rpc: rpcImpl ?? vi.fn(async () => rpcResult ?? { data: [], error: null }),
  };
}

describe('POST /api/admin/billing/generate-monthly-charges', () => {
  let previousAdminKey;
  let previousCronSecret;

  beforeEach(() => {
    previousAdminKey = process.env.ADMIN_API_KEY;
    previousCronSecret = process.env.CRON_SECRET;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
  });

  it('rejects missing and wrong admin keys, and a wrong cron secret', async () => {
    const supabase = createSupabase();
    const app = createApp(supabase);

    const missing = await request(app).post('/api/admin/billing/generate-monthly-charges');
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'unauthorized' });

    const wrongAdmin = await request(app)
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-admin-key', 'nope');
    expect(wrongAdmin.status).toBe(401);
    expect(wrongAdmin.body).toEqual({ ok: false, error: 'unauthorized' });

    const wrongCron = await request(app)
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-cron-secret', 'not-the-secret');
    expect(wrongCron.status).toBe(401);
    expect(wrongCron.body).toEqual({ ok: false, error: 'unauthorized' });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns supabase_not_configured when the client is missing', async () => {
    const res = await request(createApp(null))
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });

  it('calls generate_monthly_charges and returns the created count for an admin key', async () => {
    const rows = [
      { charge_id: CHARGE_ID, subscription_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      { charge_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    ];
    const supabase = createSupabase({ rpcResult: { data: rows, error: null } });
    const res = await request(createApp(supabase))
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, created: 2 });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('generate_monthly_charges');
  });

  it('accepts x-cron-secret the same way Discord notification routes do', async () => {
    const supabase = createSupabase({
      rpcResult: { data: [{ charge_id: CHARGE_ID }], error: null },
    });
    const res = await request(createApp(supabase))
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-cron-secret', CRON_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, created: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith('generate_monthly_charges');
  });

  it('returns created 0 on a second run when the RPC skips an existing period', async () => {
    const supabase = createSupabase({
      rpcImpl: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ charge_id: CHARGE_ID }], error: null })
        .mockResolvedValueOnce({ data: [], error: null }),
    });
    const app = createApp(supabase);

    const first = await request(app)
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-cron-secret', CRON_SECRET);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, created: 1 });

    const second = await request(app)
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-cron-secret', CRON_SECRET);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, created: 0 });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'generate_monthly_charges');
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'generate_monthly_charges');
  });

  it('returns the RPC error message on failure', async () => {
    const supabase = createSupabase({
      rpcResult: { data: null, error: { message: 'permission denied for function generate_monthly_charges' } },
    });
    const res = await request(createApp(supabase))
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      error: 'permission denied for function generate_monthly_charges',
    });
  });

  it('keeps generate_monthly_charges skip-if-exists for the same coverage period', () => {
    const sql = readFileSync(MIGRATION_0002, 'utf8');
    expect(sql).toMatch(/create or replace function generate_monthly_charges\(\)/);
    expect(sql).toMatch(/if not exists \(/);
    expect(sql).toMatch(/chx\.subscription_id = sub_record\.subscription_id/);
    expect(sql).toMatch(/chx\.coverage_start = next_coverage_start/);
    expect(sql).toMatch(/chx\.status != 'void'/);
  });
});
