import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { registerAdminBillingRoutes } from './billing.js';

const ADMIN_KEY = 'api-test-002-admin-key';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUBSCRIPTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function createApp(supabase) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(requireAdmin);
  registerAdminBillingRoutes(router, { supabase });
  app.use('/api/admin', router);
  return app;
}

function auth(req) {
  return req.set('x-admin-key', ADMIN_KEY);
}

function createSupabase({ rpcResult } = {}) {
  return {
    from: vi.fn(() => {
      throw new Error('subscriptions tests must not query tables');
    }),
    rpc: vi.fn(async () => rpcResult ?? { data: null, error: null }),
  };
}

const validBody = {
  participant_id: PARTICIPANT_ID,
  plan_definition_id: PLAN_ID,
};

describe('POST /api/admin/billing/subscriptions', () => {
  let previousAdminKey;

  beforeEach(() => {
    previousAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
  });

  it('rejects missing and wrong admin keys', async () => {
    const supabase = createSupabase();
    const app = createApp(supabase);

    const missing = await request(app).post('/api/admin/billing/subscriptions').send(validBody);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'unauthorized' });

    const wrong = await request(app)
      .post('/api/admin/billing/subscriptions')
      .set('x-admin-key', 'nope')
      .send(validBody);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ ok: false, error: 'unauthorized' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns supabase_not_configured when client is missing', async () => {
    const res = await auth(request(createApp(null)).post('/api/admin/billing/subscriptions').send(validBody));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });

  it('rejects missing required ids', async () => {
    const supabase = createSupabase();
    const app = createApp(supabase);

    const noParticipant = await auth(request(app).post('/api/admin/billing/subscriptions').send({ plan_definition_id: PLAN_ID }));
    expect(noParticipant.status).toBe(400);
    expect(noParticipant.body).toEqual({ ok: false, error: 'participant_id_required' });

    const noPlan = await auth(request(app).post('/api/admin/billing/subscriptions').send({ participant_id: PARTICIPANT_ID }));
    expect(noPlan.status).toBe(400);
    expect(noPlan.body).toEqual({ ok: false, error: 'plan_definition_id_required' });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid optional field types', async () => {
    const supabase = createSupabase();
    const app = createApp(supabase);

    const cases = [
      [{ ...validBody, starts_at: 20260601 }, 'invalid_starts_at'],
      [{ ...validBody, ends_at: 20260630 }, 'invalid_ends_at'],
      [{ ...validBody, account_id: 123 }, 'invalid_account_id'],
      [{ ...validBody, create_initial_charge: 'true' }, 'invalid_create_initial_charge'],
      [{ ...validBody, notes: { text: 'nope' } }, 'invalid_notes'],
    ];

    for (const [body, error] of cases) {
      const res = await auth(request(app).post('/api/admin/billing/subscriptions').send(body));
      expect(res.status, error).toBe(400);
      expect(res.body, error).toEqual({ ok: false, error });
    }

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns the RPC error message on failure', async () => {
    const supabase = createSupabase({
      rpcResult: { data: null, error: { message: 'participant not found' } },
    });
    const res = await auth(request(createApp(supabase)).post('/api/admin/billing/subscriptions').send(validBody));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'participant not found' });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_subscription',
      expect.objectContaining({
        p_participant_id: PARTICIPANT_ID,
        p_plan_definition_id: PLAN_ID,
        p_create_initial_charge: false,
        p_created_by: 'admin_api',
      }),
    );
  });

  it('creates a subscription through the isolated RPC fixture', async () => {
    const supabase = createSupabase({
      rpcResult: {
        data: {
          subscription_id: SUBSCRIPTION_ID,
          account_id: ACCOUNT_ID,
          participant_id: PARTICIPANT_ID,
          plan_definition_id: PLAN_ID,
          initial_charge_id: null,
        },
        error: null,
      },
    });

    const res = await auth(
      request(createApp(supabase))
        .post('/api/admin/billing/subscriptions')
        .send({
          ...validBody,
          starts_at: '2026-06-01',
          ends_at: '2026-09-01',
          account_id: ACCOUNT_ID,
          create_initial_charge: false,
          notes: 'trial',
          created_by: 'front-desk',
        }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      subscription_id: SUBSCRIPTION_ID,
      account_id: ACCOUNT_ID,
      participant_id: PARTICIPANT_ID,
      plan_definition_id: PLAN_ID,
      initial_charge_id: null,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_subscription', {
      p_participant_id: PARTICIPANT_ID,
      p_plan_definition_id: PLAN_ID,
      p_starts_at: '2026-06-01',
      p_ends_at: '2026-09-01',
      p_account_id: ACCOUNT_ID,
      p_create_initial_charge: false,
      p_notes: 'trial',
      p_created_by: 'front-desk',
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
