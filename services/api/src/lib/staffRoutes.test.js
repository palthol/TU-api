import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequireAdmin } from './requireAdmin.js';
import { hashStaffKey } from './staffAuth.js';
import { registerStaffAuthRoutes } from './staffRoutes.js';

const ADMIN_KEY = 'test-admin-key-staff-routes';
const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function createStaffSupabase({ seed = [] } = {}) {
  const tables = {
    staff_users: seed.map((row) => ({ ...row })),
  };

  function matches(row, filters) {
    return filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      return true;
    });
  }

  function execute(state, mode) {
    return Promise.resolve().then(() => {
      if (!tables[state.table]) tables[state.table] = [];
      if (state.action === 'insert') {
        const emailTaken = tables[state.table].some(
          (row) => String(row.email).toLowerCase() === String(state.payload.email).toLowerCase(),
        );
        if (emailTaken) {
          return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        const row = { id: state.payload.id || randomUUID(), last_used_at: null, ...state.payload };
        tables[state.table].push(row);
        if (mode === 'single') return { data: row, error: null };
        return { data: [row], error: null };
      }
      if (state.action === 'update') {
        const rows = tables[state.table].filter((row) => matches(row, state.filters));
        for (const row of rows) Object.assign(row, state.payload);
        if (mode === 'single') {
          return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
        }
        if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      }
      const rows = tables[state.table].filter((row) => matches(row, state.filters));
      if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
      if (mode === 'single') {
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      }
      return { data: rows, error: null };
    });
  }

  const supabase = {
    from(table) {
      const state = { table, action: 'select', payload: null, filters: [] };
      const builder = {
        select() {
          return builder;
        },
        insert(row) {
          state.action = 'insert';
          state.payload = row;
          return builder;
        },
        update(row) {
          state.action = 'update';
          state.payload = row;
          return builder;
        },
        eq(col, val) {
          state.filters.push(['eq', col, val]);
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return execute(state, 'maybeSingle');
        },
        single() {
          return execute(state, 'single');
        },
        then(onFulfilled, onRejected) {
          return execute(state, 'many').then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };

  return { supabase, tables };
}

function createApp(supabase) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(createRequireAdmin());
  registerStaffAuthRoutes(router, { supabase });
  app.use('/api/admin', router);
  return app;
}

function ownerSeed() {
  return {
    id: OWNER_ID,
    email: 'owner@example.com',
    display_name: 'Owner',
    role: 'owner',
    key_hash: hashStaffKey('owner-key'),
    key_prefix: 'tu_sk_owner',
    active: true,
    created_at: '2026-09-14T00:00:00.000Z',
    updated_at: '2026-09-14T00:00:00.000Z',
    last_used_at: null,
  };
}

describe('staff auth routes', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
  });

  it('returns the legacy owner on GET /auth/me', async () => {
    const { supabase } = createStaffSupabase();
    const app = createApp(supabase);
    const res = await request(app).get('/api/admin/auth/me').set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.staff).toMatchObject({
      role: 'owner',
      auth_method: 'legacy_shared_key',
      actor_label: 'legacy_shared_key',
    });
  });

  it('creates a staff key once and does not echo the hash', async () => {
    const { supabase, tables } = createStaffSupabase({ seed: [ownerSeed()] });
    const app = createApp(supabase);
    const res = await request(app)
      .post('/api/admin/staff')
      .set('x-admin-key', ADMIN_KEY)
      .send({ email: 'desk@example.com', display_name: 'Front Desk', role: 'front_desk' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.api_key).toMatch(/^tu_sk_[a-f0-9]{64}$/);
    expect(res.body.staff.email).toBe('desk@example.com');
    expect(res.body.staff.role).toBe('front_desk');
    expect(JSON.stringify(res.body)).not.toContain('key_hash');
    expect(tables.staff_users[1].key_hash).toBe(hashStaffKey(res.body.api_key));
  });

  it('rejects duplicate emails', async () => {
    const { supabase } = createStaffSupabase({ seed: [ownerSeed()] });
    const app = createApp(supabase);
    const res = await request(app)
      .post('/api/admin/staff')
      .set('x-admin-key', ADMIN_KEY)
      .send({ email: 'owner@example.com', display_name: 'Other', role: 'finance' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'email_taken' });
  });

  it('refuses to deactivate the last owner', async () => {
    const { supabase } = createStaffSupabase({ seed: [ownerSeed()] });
    const app = createApp(supabase);
    const res = await request(app)
      .patch(`/api/admin/staff/${OWNER_ID}`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ active: false });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'last_owner' });
  });

  it('rotates a key and returns plaintext once', async () => {
    const { supabase, tables } = createStaffSupabase({
      seed: [
        ownerSeed(),
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          email: 'finance@example.com',
          display_name: 'Finance',
          role: 'finance',
          key_hash: hashStaffKey('old-key'),
          key_prefix: 'tu_sk_oldkey',
          active: true,
          created_at: '2026-09-14T00:00:00.000Z',
          updated_at: '2026-09-14T00:00:00.000Z',
          last_used_at: null,
        },
      ],
    });
    const app = createApp(supabase);
    const res = await request(app)
      .patch('/api/admin/staff/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
      .set('x-admin-key', ADMIN_KEY)
      .send({ rotate_key: true });
    expect(res.status).toBe(200);
    expect(res.body.api_key).toMatch(/^tu_sk_[a-f0-9]{64}$/);
    expect(tables.staff_users[1].key_hash).toBe(hashStaffKey(res.body.api_key));
    expect(tables.staff_users[1].key_hash).not.toBe(hashStaffKey('old-key'));
  });
});
