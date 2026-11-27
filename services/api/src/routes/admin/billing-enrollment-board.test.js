import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { registerAdminBillingRoutes } from './billing.js';

const PERSONAL_KEY = 'enrollment-board-personal-key';
const SHARED_KEY = 'enrollment-board-shared-key';
const CASEY_ID = '11111111-1111-4111-8111-111111111111';
const RILEY_ID = '22222222-2222-4222-8222-222222222222';
const JORDAN_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUB_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const people = [
  {
    id: CASEY_ID,
    full_name: 'Casey Placeholder',
    is_placeholder: true,
    placeholder_reason: 'name only; no waiver yet',
    dob_is_placeholder: true,
    merged_into_participant_id: null,
  },
  {
    id: RILEY_ID,
    full_name: 'Riley Gymtest',
    is_placeholder: false,
    placeholder_reason: null,
    dob_is_placeholder: false,
    merged_into_participant_id: null,
  },
  {
    id: JORDAN_ID,
    full_name: 'Jordan Faketest',
    is_placeholder: false,
    placeholder_reason: null,
    dob_is_placeholder: false,
    merged_into_participant_id: null,
  },
];

const memberships = [
  {
    participant_id: CASEY_ID,
    account_id: ACCOUNT_A,
    created_at: '2026-11-01T00:00:00.000Z',
    accounts: { id: ACCOUNT_A, primary_contact_name: 'Casey Placeholder household', status: 'active' },
  },
  {
    participant_id: RILEY_ID,
    account_id: ACCOUNT_B,
    created_at: '2026-11-01T00:00:00.000Z',
    accounts: { id: ACCOUNT_B, primary_contact_name: 'Riley Gymtest', status: 'active' },
  },
  {
    participant_id: JORDAN_ID,
    account_id: ACCOUNT_B,
    created_at: '2026-11-02T00:00:00.000Z',
    accounts: { id: ACCOUNT_B, primary_contact_name: 'Riley Gymtest', status: 'active' },
  },
];

const subscriptions = [
  {
    id: SUB_ID,
    participant_id: RILEY_ID,
    account_id: ACCOUNT_B,
    status: 'active',
    starts_at: '2020-01-01',
    ends_at: null,
    created_at: '2020-01-01T00:00:00.000Z',
    plan_definition_id: PLAN_ID,
    plan_definitions: { id: PLAN_ID, name: 'Basic Group Plan' },
  },
];

const waivers = [{ participant_id: RILEY_ID }, { participant_id: JORDAN_ID }];

function thenableQuery(run) {
  const state = { filters: [], ilike: null };
  const q = {
    select: vi.fn(() => q),
    is: vi.fn((col, val) => {
      state.filters.push({ op: 'is', col, val });
      return q;
    }),
    eq: vi.fn((col, val) => {
      state.filters.push({ op: 'eq', col, val });
      return q;
    }),
    in: vi.fn((col, val) => {
      state.filters.push({ op: 'in', col, val });
      return q;
    }),
    ilike: vi.fn((col, val) => {
      state.ilike = { col, val };
      return q;
    }),
    order: vi.fn(() => q),
    then: (resolve, reject) => Promise.resolve(run(state)).then(resolve, reject),
  };
  return q;
}

function staffFor(role) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
    email: `${role}@example.com`,
    displayName: role,
    role,
    authMethod: AUTH_METHOD.STAFF_KEY,
    actorLabel: `staff:${role}`,
  };
}

function setup({ role = 'finance' } = {}) {
  const db = {
    from: vi.fn((table) =>
      thenableQuery((state) => {
        if (table === 'participants') {
          let rows = people.filter((row) => row.merged_into_participant_id == null);
          if (state.ilike?.col === 'full_name') {
            const raw = String(state.ilike.val).replace(/^%/, '').replace(/%$/, '');
            const needle = raw.replace(/\\([%_\\])/g, '$1').toLowerCase();
            rows = rows.filter((row) => String(row.full_name).toLowerCase().includes(needle));
          }
          rows = [...rows].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
          return { data: rows, error: null };
        }
        if (table === 'account_members') return { data: memberships, error: null };
        if (table === 'subscriptions') return { data: subscriptions, error: null };
        if (table === 'waivers') return { data: waivers, error: null };
        return { data: [], error: null };
      }),
    ),
    rpc: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(
    createRequireAdmin({
      lookupStaff: async (key) => (key === PERSONAL_KEY ? staffFor(role) : null),
    }),
  );
  registerAdminBillingRoutes(router, { supabase: db });
  app.use('/api/admin', router);
  return { app, db };
}

describe('GET /api/admin/billing/enrollment-board', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = SHARED_KEY;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
  });

  it('rejects missing keys and allows finance, owner, and front_desk reads', async () => {
    const missing = await request(setup().app).get('/api/admin/billing/enrollment-board');
    expect(missing.status).toBe(401);

    for (const role of ['owner', 'finance', 'front_desk']) {
      const { app } = setup({ role });
      const res = await request(app)
        .get('/api/admin/billing/enrollment-board')
        .set('x-admin-key', PERSONAL_KEY);
      expect(res.status, role).toBe(200);
      expect(res.body.ok, role).toBe(true);
    }
  });

  it('returns counts and rows with current enrollment and waiver flags', async () => {
    const { app } = setup({ role: 'finance' });
    const res = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .set('x-admin-key', PERSONAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      total: 3,
      enrolled: 1,
      unenrolled: 2,
      placeholders: 1,
    });
    expect(res.body.rows).toEqual([
      {
        participant_id: CASEY_ID,
        first_name: 'Casey',
        last_name: 'Placeholder',
        is_placeholder: true,
        placeholder_reason: 'name only; no waiver yet',
        dob_is_placeholder: true,
        waiver_signed: false,
        account_id: ACCOUNT_A,
        account_name: 'Casey Placeholder household',
        subscription: null,
      },
      {
        participant_id: JORDAN_ID,
        first_name: 'Jordan',
        last_name: 'Faketest',
        is_placeholder: false,
        placeholder_reason: null,
        dob_is_placeholder: false,
        waiver_signed: true,
        account_id: ACCOUNT_B,
        account_name: 'Riley Gymtest',
        subscription: null,
      },
      {
        participant_id: RILEY_ID,
        first_name: 'Riley',
        last_name: 'Gymtest',
        is_placeholder: false,
        placeholder_reason: null,
        dob_is_placeholder: false,
        waiver_signed: true,
        account_id: ACCOUNT_B,
        account_name: 'Riley Gymtest',
        subscription: {
          id: SUB_ID,
          plan_id: PLAN_ID,
          plan_name: 'Basic Group Plan',
          status: 'active',
          start_date: '2020-01-01',
        },
      },
    ]);
  });

  it('filters by status and name search', async () => {
    const { app } = setup({ role: 'front_desk' });

    const placeholders = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .query({ status: 'placeholder' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(placeholders.status).toBe(200);
    expect(placeholders.body.counts.total).toBe(3);
    expect(placeholders.body.rows.map((row) => row.participant_id)).toEqual([CASEY_ID]);

    const unenrolled = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .query({ status: 'unenrolled' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(unenrolled.body.rows.map((row) => row.participant_id)).toEqual([CASEY_ID, JORDAN_ID]);

    const enrolled = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .query({ status: 'enrolled' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(enrolled.body.rows.map((row) => row.participant_id)).toEqual([RILEY_ID]);

    const search = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .query({ q: 'Casey' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(search.body.counts).toEqual({
      total: 1,
      enrolled: 0,
      unenrolled: 1,
      placeholders: 1,
    });
    expect(search.body.rows).toHaveLength(1);
    expect(search.body.rows[0].participant_id).toBe(CASEY_ID);
  });

  it('rejects invalid status and short q', async () => {
    const { app } = setup();
    const badStatus = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .query({ status: 'all' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body).toEqual({ ok: false, error: 'invalid_status' });

    const short = await request(app)
      .get('/api/admin/billing/enrollment-board')
      .query({ q: 'C' })
      .set('x-admin-key', PERSONAL_KEY);
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ ok: false, error: 'query_min_length_2' });
  });
});
