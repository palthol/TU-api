import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequireAdmin, requireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { ADMIN_SESSION_COOKIE_NAME, encryptAdminSession } from '../../lib/adminSession.js';
import { registerAdminBillingRoutes } from './billing.js';

const PERSONAL_KEY = 'test-personal-key';
const SHARED_KEY = 'billing-plans-shared-admin-key';
const PARTICIPANT_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const INACTIVE_PLAN_ID = '44444444-4444-4444-8444-444444444444';
const SUBSCRIPTION_ID = '55555555-5555-4555-8555-555555555555';

const ACTIVE_GROUP = {
  id: PLAN_ID,
  name: 'Basic Group Plan',
  plan_category: 'group',
  billing_cadence: 'monthly',
  price_cents: 10000,
  is_active: true,
};
const ACTIVE_PRIVATE = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Private Basic Plan',
  plan_category: 'private',
  billing_cadence: 'monthly',
  price_cents: 15000,
  is_active: true,
};
const INACTIVE_PLAN = {
  id: INACTIVE_PLAN_ID,
  name: 'Retired Drop-In',
  plan_category: 'group',
  billing_cadence: 'per_session',
  price_cents: 2500,
  is_active: false,
};

function thenableQuery(result) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

function setup({ role = 'finance', tables = {} } = {}) {
  const queries = [];
  const db = {
    from: vi.fn((table) => {
      const q = thenableQuery(tables[table] ?? { data: [], error: null });
      queries.push({ table, q });
      return q;
    }),
    rpc: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(
    createRequireAdmin({
      lookupStaff: async (key) =>
        key === PERSONAL_KEY
          ? {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: `${role}@example.com`,
              displayName: role,
              role,
              authMethod: AUTH_METHOD.STAFF_KEY,
              actorLabel: `staff:${role}`,
            }
          : null,
    }),
  );
  registerAdminBillingRoutes(router, { supabase: db });
  app.use('/api/admin', router);
  return { app, db, queries };
}

function sharedKeyApp(supabase) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(requireAdmin);
  registerAdminBillingRoutes(router, { supabase });
  app.use('/api/admin', router);
  return app;
}

describe('GET /api/admin/billing/plans', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = SHARED_KEY;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_EMAIL;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  it('rejects missing and wrong admin keys', async () => {
    const { app, db } = setup();
    const missing = await request(app).get('/api/admin/billing/plans');
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'unauthorized' });

    const wrong = await request(app).get('/api/admin/billing/plans').set('x-admin-key', 'nope');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ ok: false, error: 'unauthorized' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rejects cron-only callers', async () => {
    const { app, db } = setup();
    const res = await request(app).get('/api/admin/billing/plans').set('x-cron-secret', 'test-secret');
    expect(res.status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each(['owner', 'finance', 'front_desk'])('allows %s to list active plans', async (role) => {
    const { app, queries } = setup({
      role,
      tables: { plan_definitions: { data: [ACTIVE_GROUP, ACTIVE_PRIVATE], error: null } },
    });
    const res = await request(app).get('/api/admin/billing/plans').set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plans: [ACTIVE_GROUP, ACTIVE_PRIVATE] });
    expect(queries[0].q.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('authorizes the shared admin key as owner', async () => {
    const db = { from: vi.fn(() => thenableQuery({ data: [ACTIVE_GROUP], error: null })), rpc: vi.fn() };
    const res = await request(sharedKeyApp(db))
      .get('/api/admin/billing/plans')
      .set('x-admin-key', SHARED_KEY);
    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([ACTIVE_GROUP]);
  });

  it('authorizes a matching admin session cookie', async () => {
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.ADMIN_EMAIL = 'singh@example.com';
    const token = await encryptAdminSession({ email: 'singh@example.com' });
    const db = { from: vi.fn(() => thenableQuery({ data: [ACTIVE_GROUP], error: null })), rpc: vi.fn() };
    const res = await request(sharedKeyApp(db))
      .get('/api/admin/billing/plans')
      .set('Cookie', `${ADMIN_SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plans: [ACTIVE_GROUP] });
  });

  it('returns supabase_not_configured when the client is missing', async () => {
    const res = await request(sharedKeyApp(null))
      .get('/api/admin/billing/plans')
      .set('x-admin-key', SHARED_KEY);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });

  it('excludes inactive catalog rows even if the query returns them', async () => {
    const { app, queries } = setup({
      tables: { plan_definitions: { data: [ACTIVE_GROUP, INACTIVE_PLAN, ACTIVE_PRIVATE], error: null } },
    });
    const res = await request(app).get('/api/admin/billing/plans').set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([ACTIVE_GROUP, ACTIVE_PRIVATE]);
    expect(res.body.plans.some((plan) => plan.id === INACTIVE_PLAN_ID || plan.is_active === false)).toBe(false);
    expect(queries[0].q.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('returns an empty list when the catalog has no active plans', async () => {
    const { app } = setup({ tables: { plan_definitions: { data: [], error: null } } });
    const res = await request(app).get('/api/admin/billing/plans').set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plans: [] });
  });
});

describe('GET /api/admin/billing/subscriptions/current', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = SHARED_KEY;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
  });

  function currentSubscription({
    plan = ACTIVE_GROUP,
    status = 'active',
    starts_at = '2020-01-01',
    ends_at = null,
    participant_id = PARTICIPANT_ID,
    account_id = ACCOUNT_ID,
  } = {}) {
    return {
      id: SUBSCRIPTION_ID,
      account_id,
      participant_id,
      status,
      starts_at,
      ends_at,
      created_at: '2020-01-01T00:00:00.000Z',
      plan_definitions: plan,
    };
  }

  it('rejects missing and wrong admin keys', async () => {
    const { app, db } = setup();
    const missing = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID });
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'unauthorized' });

    const wrong = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID })
      .set('x-admin-key', 'nope');
    expect(wrong.status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each(['owner', 'finance', 'front_desk'])('allows %s to read the current plan', async (role) => {
    const { app } = setup({
      role,
      tables: { subscriptions: { data: [currentSubscription()], error: null } },
    });
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID })
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plan: ACTIVE_GROUP });
  });

  it('requires a participant or account id', async () => {
    const { app, db } = setup();
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'participant_or_account_id_required' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rejects invalid uuids before querying', async () => {
    const { app, db } = setup();
    const badParticipant = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: 'not-a-uuid' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(badParticipant.status).toBe(400);
    expect(badParticipant.body).toEqual({ ok: false, error: 'invalid_participant_id' });

    const badAccount = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ account_id: 'nope' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(badAccount.status).toBe(400);
    expect(badAccount.body).toEqual({ ok: false, error: 'invalid_account_id' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns plan null when the person has no active subscription', async () => {
    const { app, queries } = setup({
      tables: { subscriptions: { data: [], error: null } },
    });
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID })
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plan: null });
    expect(queries[0].table).toBe('subscriptions');
    expect(queries[0].q.eq).toHaveBeenCalledWith('status', 'active');
    expect(queries[0].q.eq).toHaveBeenCalledWith('participant_id', PARTICIPANT_ID);
  });

  it('returns plan null for an account with no subscriptions', async () => {
    const { app, queries } = setup({
      tables: { subscriptions: { data: [], error: null } },
    });
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ account_id: ACCOUNT_ID })
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plan: null });
    expect(queries[0].q.eq).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
  });

  it('returns the enrolled plan for a populated current subscription', async () => {
    const { app, queries } = setup({
      tables: { subscriptions: { data: [currentSubscription()], error: null } },
    });
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID, account_id: ACCOUNT_ID })
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plan: ACTIVE_GROUP });
    expect(res.body.plan).not.toHaveProperty('description');
    expect(queries[0].q.eq).toHaveBeenCalledWith('participant_id', PARTICIPANT_ID);
    expect(queries[0].q.eq).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
  });

  it('does not treat paused, cancelled, future, or ended enrollments as current', async () => {
    const { app } = setup({
      tables: {
        subscriptions: {
          data: [
            currentSubscription({ status: 'paused' }),
            currentSubscription({ status: 'cancelled' }),
            currentSubscription({ starts_at: '2099-01-01' }),
            currentSubscription({ starts_at: '2019-01-01', ends_at: '2019-12-31' }),
          ],
          error: null,
        },
      },
    });
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID })
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plan: null });
  });

  it('still returns a currently enrolled plan after the catalog row is deactivated', async () => {
    const { app } = setup({
      tables: {
        subscriptions: {
          data: [currentSubscription({ plan: INACTIVE_PLAN })],
          error: null,
        },
      },
    });
    const res = await request(app)
      .get('/api/admin/billing/subscriptions/current')
      .query({ participant_id: PARTICIPANT_ID })
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      plan: {
        id: INACTIVE_PLAN_ID,
        name: 'Retired Drop-In',
        plan_category: 'group',
        billing_cadence: 'per_session',
        price_cents: 2500,
        is_active: false,
      },
    });
  });
});
