import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLACEHOLDER_DATE_OF_BIRTH } from '../../lib/placeholderParticipant.js';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { registerAdminParticipantRoutes } from './participants.js';

const PERSONAL_KEY = 'placeholder-personal-key';
const SHARED_KEY = 'placeholder-shared-admin-key';
const PARTICIPANT_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const SUBSCRIPTION_ID = '44444444-4444-4444-8444-444444444444';

const validBody = {
  first_name: 'Casey',
  last_name: 'Placeholder',
  placeholder_reason: 'name only; no waiver yet',
  date_of_birth: '1990-05-05',
};

function staffFor(role) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: `${role}@example.com`,
    displayName: role,
    role,
    authMethod: AUTH_METHOD.STAFF_KEY,
    actorLabel: `staff:${role}`,
  };
}

function setup({ role = 'front_desk', rpcResult, rpcImpl } = {}) {
  const rpc = rpcImpl ?? vi.fn(async () => rpcResult ?? { data: null, error: null });
  const db = {
    from: vi.fn(() => {
      throw new Error('placeholder create must not write tables directly');
    }),
    rpc,
  };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(
    createRequireAdmin({
      lookupStaff: async (key) => (key === PERSONAL_KEY ? staffFor(role) : null),
    }),
  );
  registerAdminParticipantRoutes(router, { supabase: db });
  app.use('/api/admin', router);
  return { app, db };
}

describe('POST /api/admin/participants/placeholders', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = SHARED_KEY;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
  });

  it('rejects missing and wrong admin keys', async () => {
    const { app, db } = setup();
    const missing = await request(app).post('/api/admin/participants/placeholders').send(validBody);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'unauthorized' });
    const wrong = await request(app)
      .post('/api/admin/participants/placeholders')
      .set('x-admin-key', 'nope')
      .send(validBody);
    expect(wrong.status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('forbids finance writes and allows owner and front_desk', async () => {
    const finance = setup({ role: 'finance' });
    const denied = await request(finance.app)
      .post('/api/admin/participants/placeholders')
      .set('x-admin-key', PERSONAL_KEY)
      .send(validBody);
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ ok: false, error: 'forbidden' });
    expect(finance.db.rpc).not.toHaveBeenCalled();

    const desk = setup({
      role: 'front_desk',
      rpcResult: {
        data: {
          participant: {
            id: PARTICIPANT_ID,
            first_name: 'Casey',
            last_name: 'Placeholder',
            is_placeholder: true,
            placeholder_reason: 'name only; no waiver yet',
            dob_is_placeholder: false,
          },
          account_id: ACCOUNT_ID,
          subscription: null,
        },
        error: null,
      },
    });
    const allowed = await request(desk.app)
      .post('/api/admin/participants/placeholders')
      .set('x-admin-key', PERSONAL_KEY)
      .send(validBody);
    expect(allowed.status).toBe(201);
    expect(desk.db.rpc).toHaveBeenCalledOnce();
  });

  it('validates names, reasons, and stand-in DOB rules before calling the RPC', async () => {
    const { app, db } = setup({ role: 'owner' });
    const cases = [
      [{ ...validBody, first_name: 'C' }, 'invalid_first_name'],
      [{ ...validBody, placeholder_reason: '  ' }, 'placeholder_reason_required'],
      [{ first_name: 'Casey', last_name: 'Placeholder', placeholder_reason: 'desk' }, 'date_of_birth_required'],
      [
        { ...validBody, date_of_birth: PLACEHOLDER_DATE_OF_BIRTH },
        'dob_is_placeholder_required',
      ],
      [
        { ...validBody, dob_is_placeholder: true },
        'dob_placeholder_reason_required',
      ],
      [
        {
          ...validBody,
          account_id: ACCOUNT_ID,
          account_name: 'Household',
        },
        'account_id_xor_account_name',
      ],
    ];
    for (const [body, error] of cases) {
      const res = await request(app)
        .post('/api/admin/participants/placeholders')
        .set('x-admin-key', PERSONAL_KEY)
        .send(body);
      expect(res.status, error).toBe(400);
      expect(res.body, error).toEqual({ ok: false, error });
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('creates a placeholder and optional enrollment atomically through the RPC', async () => {
    const { app, db } = setup({
      role: 'front_desk',
      rpcResult: {
        data: {
          participant: {
            id: PARTICIPANT_ID,
            first_name: 'Casey',
            last_name: 'Placeholder',
            is_placeholder: true,
            placeholder_reason: 'name only; no waiver yet',
            dob_is_placeholder: true,
          },
          account_id: ACCOUNT_ID,
          subscription: {
            id: SUBSCRIPTION_ID,
            plan_id: PLAN_ID,
            status: 'active',
            start_date: '2026-11-01',
          },
        },
        error: null,
      },
    });

    const res = await request(app)
      .post('/api/admin/participants/placeholders')
      .set('x-admin-key', PERSONAL_KEY)
      .send({
        first_name: 'Casey',
        last_name: 'Placeholder',
        placeholder_reason: 'name only; no waiver yet',
        dob_is_placeholder: true,
        dob_placeholder_reason: 'DOB unknown at desk',
        plan_id: PLAN_ID,
        start_date: '2026-11-01',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      participant: {
        id: PARTICIPANT_ID,
        first_name: 'Casey',
        last_name: 'Placeholder',
        is_placeholder: true,
        placeholder_reason: 'name only; no waiver yet',
        dob_is_placeholder: true,
      },
      account_id: ACCOUNT_ID,
      subscription: {
        id: SUBSCRIPTION_ID,
        plan_id: PLAN_ID,
        status: 'active',
        start_date: '2026-11-01',
      },
    });
    expect(db.rpc).toHaveBeenCalledWith('create_placeholder_participant', {
      p_first_name: 'Casey',
      p_last_name: 'Placeholder',
      p_placeholder_reason: 'name only; no waiver yet',
      p_email: null,
      p_phone: null,
      p_date_of_birth: PLACEHOLDER_DATE_OF_BIRTH,
      p_dob_is_placeholder: true,
      p_dob_placeholder_reason: 'DOB unknown at desk',
      p_account_id: null,
      p_account_name: null,
      p_plan_id: PLAN_ID,
      p_start_date: '2026-11-01',
      p_created_by: 'staff:front_desk',
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns 409 duplicate_name without writing when the RPC rejects', async () => {
    const { app, db } = setup({
      role: 'owner',
      rpcResult: {
        data: null,
        error: {
          message: 'duplicate_name',
          details: JSON.stringify({ existing_participant_id: PARTICIPANT_ID }),
        },
      },
    });
    const res = await request(app)
      .post('/api/admin/participants/placeholders')
      .set('x-admin-key', PERSONAL_KEY)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      error: 'duplicate_name',
      existing_participant_id: PARTICIPANT_ID,
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rolls back by not issuing follow-up writes when enrollment fails', async () => {
    const { app, db } = setup({
      role: 'front_desk',
      rpcResult: { data: null, error: { message: 'overlapping_active_subscription' } },
    });
    const res = await request(app)
      .post('/api/admin/participants/placeholders')
      .set('x-admin-key', PERSONAL_KEY)
      .send({
        ...validBody,
        plan_id: PLAN_ID,
        start_date: '2026-11-01',
      });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'overlapping_active_subscription' });
    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.from).not.toHaveBeenCalled();
  });
});
