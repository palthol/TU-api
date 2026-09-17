import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from './lib/requireAdmin.js';
import { createRequireAdminOrCron } from './lib/requireAdminOrCron.js';
import { registerAdminBillingCronRoutes } from './routes/admin/billing.js';

const ADMIN_KEY = 'test-admin-key-cron-mount';
const CRON_SECRET = 'test-cron-secret-cron-mount';

function createSupabase() {
  return {
    from: vi.fn(() => {
      throw new Error('cron mount tests must not query tables');
    }),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
}

function createApp() {
  const supabase = createSupabase();
  const app = express();
  app.use(express.json());

  const adminBillingRouter = express.Router();
  adminBillingRouter.use(requireAdmin);
  adminBillingRouter.post('/billing/admin-only', (_req, res) => res.json({ ok: true }));

  const adminCronRouter = express.Router();
  const requireAdminOrCron = createRequireAdminOrCron(requireAdmin);
  adminCronRouter.use('/billing/generate-monthly-charges', requireAdminOrCron);
  registerAdminBillingCronRoutes(adminCronRouter, { supabase });

  // Match production mount order expectations: cron-capable routes must be reachable.
  app.use('/api/admin', adminCronRouter);
  app.use('/api/admin', adminBillingRouter);

  return { app, supabase };
}

describe('admin router mount order (cron vs admin-key)', () => {
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

  it('accepts cron-secret for cron routes but rejects cron-secret for admin-only routes', async () => {
    const { app, supabase } = createApp();

    const cronOk = await request(app)
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-cron-secret', CRON_SECRET);
    expect(cronOk.status).toBe(200);
    expect(cronOk.body).toEqual({ ok: true, created: 0 });
    expect(supabase.rpc).toHaveBeenCalledWith('generate_monthly_charges');

    const cronDenied = await request(app)
      .post('/api/admin/billing/admin-only')
      .set('x-cron-secret', CRON_SECRET);
    expect(cronDenied.status).toBe(401);
    expect(cronDenied.body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('accepts admin-key for both admin-only and cron routes', async () => {
    const { app, supabase } = createApp();

    const adminOk = await request(app).post('/api/admin/billing/admin-only').set('x-admin-key', ADMIN_KEY);
    expect(adminOk.status).toBe(200);
    expect(adminOk.body).toEqual({ ok: true });

    const cronViaAdmin = await request(app)
      .post('/api/admin/billing/generate-monthly-charges')
      .set('x-admin-key', ADMIN_KEY);
    expect(cronViaAdmin.status).toBe(200);
    expect(cronViaAdmin.body).toEqual({ ok: true, created: 0 });
    expect(supabase.rpc).toHaveBeenCalledWith('generate_monthly_charges');
  });
});

