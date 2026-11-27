import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { ADMIN_SESSION_COOKIE_NAME, encryptAdminSession } from '../../lib/adminSession.js';
import { createAdminSchedulingV2Router } from './index.js';

const ADMIN_KEY = 'test-admin-key-classes';
const CLASS_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

const financeStaff = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'finance@example.com',
  displayName: 'Finance',
  role: 'finance',
  authMethod: AUTH_METHOD.STAFF_KEY,
  actorLabel: 'staff:11111111-1111-1111-1111-111111111111',
};

const deskStaff = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'desk@example.com',
  displayName: 'Desk',
  role: 'front_desk',
  authMethod: AUTH_METHOD.STAFF_KEY,
  actorLabel: 'staff:22222222-2222-2222-2222-222222222222',
};

function createClassesFixture({ listError = null } = {}) {
  const classes = new Map();

  function createQuery() {
    const state = {
      op: 'select',
      payload: undefined,
      filters: [],
      orders: [],
      range: null,
      terminal: null,
    };

    const run = () => runClasses(state);

    const api = {
      select() {
        return api;
      },
      insert(payload) {
        state.op = 'insert';
        state.payload = payload;
        return api;
      },
      update(payload) {
        state.op = 'update';
        state.payload = payload;
        return api;
      },
      delete() {
        state.op = 'delete';
        return api;
      },
      eq(col, val) {
        state.filters.push({ op: 'eq', col, val });
        return api;
      },
      order(col, opts) {
        state.orders.push({ col, opts });
        return api;
      },
      range(from, to) {
        state.range = { from, to };
        return api;
      },
      maybeSingle() {
        state.terminal = 'maybeSingle';
        return Promise.resolve(run());
      },
      single() {
        state.terminal = 'single';
        return Promise.resolve(run());
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return api;
  }

  function applyFilters(rows, filters) {
    let next = rows;
    for (const f of filters) {
      if (f.op === 'eq') next = next.filter((r) => r[f.col] === f.val);
    }
    return next;
  }

  function runClasses(state) {
    if (state.op === 'select' && listError) return { data: null, error: listError };

    if (state.op === 'insert') {
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        created_at: now,
        updated_at: now,
        ...state.payload,
      };
      classes.set(row.id, row);
      return { data: { ...row }, error: null };
    }

    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f.op === 'eq' && f.col === 'id');
      const existing = idFilter ? classes.get(idFilter.val) : null;
      if (!existing) return { data: null, error: { code: 'PGRST116', message: 'not found' } };
      const updated = { ...existing, ...state.payload, updated_at: new Date().toISOString() };
      classes.set(updated.id, updated);
      return { data: { ...updated }, error: null };
    }

    if (state.op === 'delete') {
      const idFilter = state.filters.find((f) => f.op === 'eq' && f.col === 'id');
      const existing = idFilter ? classes.get(idFilter.val) : null;
      if (!existing) return { data: null, error: null };
      classes.delete(existing.id);
      return { data: { ...existing }, error: null };
    }

    let rows = applyFilters([...classes.values()], state.filters);
    rows.sort((a, b) => {
      if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
      if (a.start_time !== b.start_time) return String(a.start_time).localeCompare(String(b.start_time));
      return String(a.name).localeCompare(String(b.name));
    });
    if (state.range) {
      rows = rows.slice(state.range.from, state.range.to + 1);
    }
    if (state.terminal === 'maybeSingle' || state.terminal === 'single') {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  return {
    from(table) {
      if (table !== 'classes') return { then: (resolve) => resolve({ data: null, error: { message: `unknown_table:${table}` } }) };
      return createQuery();
    },
    seed(row) {
      classes.set(row.id, { ...row });
    },
    get(id) {
      return classes.get(id) ?? null;
    },
    size() {
      return classes.size;
    },
  };
}

function createApp({ requireAdmin, supabase }) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(requireAdmin);
  router.use('/scheduling-v2', createAdminSchedulingV2Router({ supabase }));
  app.use('/api/admin', router);
  return app;
}

const validBody = {
  name: 'Class 1',
  instructor: 'Alex Rivera',
  day_of_week: 1,
  start_time: '19:00',
  duration_minutes: 90,
  capacity: 16,
};

describe('admin scheduling-v2 class CRUD', () => {
  const previousAdminKey = process.env.ADMIN_API_KEY;
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousAdminEmail = process.env.ADMIN_EMAIL;
  const previousAdminAllowedOrigins = process.env.ADMIN_ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousAdminEmail;
    if (previousAdminAllowedOrigins === undefined) delete process.env.ADMIN_ALLOWED_ORIGINS;
    else process.env.ADMIN_ALLOWED_ORIGINS = previousAdminAllowedOrigins;
  });

  it('rejects missing auth on class routes', async () => {
    const res = await request(createApp({ requireAdmin: createRequireAdmin(), supabase: createClassesFixture() })).get(
      '/api/admin/scheduling-v2/classes',
    );
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('creates, lists, reads, patches, and deletes a class with the shared admin key', async () => {
    const supabase = createClassesFixture();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const created = await request(app).post('/api/admin/scheduling-v2/classes').set('x-admin-key', ADMIN_KEY).send(validBody);
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    expect(created.body.class).toMatchObject({
      name: 'Class 1',
      instructor: 'Alex Rivera',
      day_of_week: 1,
      recurrence: 'weekly',
      start_time: '19:00:00',
      duration_minutes: 90,
      capacity: 16,
      is_active: true,
    });
    const classId = created.body.class.id;

    const noUpdates = await request(app)
      .patch(`/api/admin/scheduling-v2/classes/${classId}`)
      .set('x-admin-key', ADMIN_KEY)
      .send({});
    expect(noUpdates.status).toBe(400);
    expect(noUpdates.body.error).toBe('no_updates');

    const listed = await request(app).get('/api/admin/scheduling-v2/classes').set('x-admin-key', ADMIN_KEY);
    expect(listed.status).toBe(200);
    expect(listed.body.rowCount).toBe(1);
    expect(listed.body.rows[0].id).toBe(classId);

    const got = await request(app).get(`/api/admin/scheduling-v2/classes/${classId}`).set('x-admin-key', ADMIN_KEY);
    expect(got.status).toBe(200);
    expect(got.body.class.name).toBe('Class 1');

    const patched = await request(app)
      .patch(`/api/admin/scheduling-v2/classes/${classId}`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ instructor: 'Jordan Lee', is_active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.class.instructor).toBe('Jordan Lee');
    expect(patched.body.class.is_active).toBe(false);

    const activeOnly = await request(app).get('/api/admin/scheduling-v2/classes').set('x-admin-key', ADMIN_KEY);
    expect(activeOnly.body.rowCount).toBe(0);

    const withInactive = await request(app)
      .get('/api/admin/scheduling-v2/classes?include_inactive=true')
      .set('x-admin-key', ADMIN_KEY);
    expect(withInactive.body.rowCount).toBe(1);

    const deleted = await request(app)
      .delete(`/api/admin/scheduling-v2/classes/${classId}`)
      .set('x-admin-key', ADMIN_KEY);
    expect(deleted.status).toBe(200);
    expect(deleted.body.class.id).toBe(classId);
    expect(supabase.size()).toBe(0);
  });

  it('validates create input and does not coerce bad types', async () => {
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase: createClassesFixture() });
    const post = (body) =>
      request(app).post('/api/admin/scheduling-v2/classes').set('x-admin-key', ADMIN_KEY).send(body);

    expect((await post({ ...validBody, name: '  ' })).body.error).toBe('invalid_name');
    expect((await post({ ...validBody, instructor: 12 })).body.error).toBe('invalid_instructor');
    expect((await post({ ...validBody, day_of_week: 0 })).body.error).toBe('invalid_day_of_week');
    expect((await post({ ...validBody, start_time: '7pm' })).body.error).toBe('invalid_start_time');
    expect((await post({ ...validBody, duration_minutes: 0 })).body.error).toBe('invalid_duration_minutes');
    expect((await post({ ...validBody, capacity: 501 })).body.error).toBe('invalid_capacity');
    expect((await post({ ...validBody, recurrence: 'daily' })).body.error).toBe('invalid_recurrence');
    expect((await post({ ...validBody, is_active: 'yes' })).body.error).toBe('invalid_is_active');
    expect((await post({ ...validBody, description: 12 })).body.error).toBe('invalid_description');
    expect((await post({ ...validBody, description: 'x'.repeat(2001) })).body.error).toBe('invalid_description');
  });

  it('stores an optional description and can clear it', async () => {
    const supabase = createClassesFixture();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const blank = await request(app)
      .post('/api/admin/scheduling-v2/classes')
      .set('x-admin-key', ADMIN_KEY)
      .send({ ...validBody, description: '   ' });
    expect(blank.status).toBe(200);
    expect(blank.body.class.description).toBeNull();

    const created = await request(app)
      .post('/api/admin/scheduling-v2/classes')
      .set('x-admin-key', ADMIN_KEY)
      .send({ ...validBody, name: 'Class 2', description: '  Bring a towel  ' });
    expect(created.status).toBe(200);
    expect(created.body.class.description).toBe('Bring a towel');
    expect(created.body.class.duration_minutes).toBe(90);

    const cleared = await request(app)
      .patch(`/api/admin/scheduling-v2/classes/${created.body.class.id}`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.class.description).toBeNull();
    expect(cleared.body.class.name).toBe('Class 2');
  });

  it('returns 404 class_not_found and 400 invalid_class_id', async () => {
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase: createClassesFixture() });
    const missing = await request(app)
      .get(`/api/admin/scheduling-v2/classes/${CLASS_ID}`)
      .set('x-admin-key', ADMIN_KEY);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ ok: false, error: 'class_not_found' });

    const badId = await request(app).get('/api/admin/scheduling-v2/classes/not-a-uuid').set('x-admin-key', ADMIN_KEY);
    expect(badId.status).toBe(400);
    expect(badId.body.error).toBe('invalid_class_id');

    const noUpdates = await request(app)
      .patch(`/api/admin/scheduling-v2/classes/${CLASS_ID}`)
      .set('x-admin-key', ADMIN_KEY)
      .send({});
    expect(noUpdates.status).toBe(404);
  });

  it('maps database errors without leaking SQL text', async () => {
    const supabase = createClassesFixture({
      listError: {
        code: '23514',
        message: 'new row violates check constraint "classes_capacity_check"',
        details: 'Failing row contains (capacity)=(0)',
      },
    });
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });
    const res = await request(app).get('/api/admin/scheduling-v2/classes').set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'invalid_input' });
    expect(JSON.stringify(res.body)).not.toMatch(/classes_capacity_check/i);
  });

  it('keeps the scheduling RBAC matrix: finance cannot mutate, front_desk can', async () => {
    const supabase = createClassesFixture();
    const financeApp = createApp({
      requireAdmin: createRequireAdmin({ lookupStaff: async () => financeStaff }),
      supabase,
    });
    const deskApp = createApp({
      requireAdmin: createRequireAdmin({ lookupStaff: async () => deskStaff }),
      supabase,
    });

    const financeDenied = await request(financeApp)
      .post('/api/admin/scheduling-v2/classes')
      .set('x-admin-key', 'finance-key')
      .send(validBody);
    expect(financeDenied.status).toBe(403);
    expect(financeDenied.body.error).toBe('forbidden');

    const financeRead = await request(financeApp).get('/api/admin/scheduling-v2/classes').set('x-admin-key', 'finance-key');
    expect(financeRead.status).toBe(200);

    const deskOk = await request(deskApp)
      .post('/api/admin/scheduling-v2/classes')
      .set('x-admin-key', 'desk-key')
      .send(validBody);
    expect(deskOk.status).toBe(200);
    expect(deskOk.body.class.name).toBe('Class 1');
  });

  it('accepts cookie-session auth and requires CSRF origin on mutations', async () => {
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.ADMIN_EMAIL = 'singh@example.com';
    process.env.ADMIN_ALLOWED_ORIGINS = 'https://admin.templeunderground.com';

    const supabase = createClassesFixture();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });
    const token = await encryptAdminSession({ email: 'singh@example.com' });
    const cookie = `${ADMIN_SESSION_COOKIE_NAME}=${token}`;

    const listed = await request(app).get('/api/admin/scheduling-v2/classes').set('Cookie', cookie);
    expect(listed.status).toBe(200);

    const missingOrigin = await request(app).post('/api/admin/scheduling-v2/classes').set('Cookie', cookie).send(validBody);
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error).toBe('csrf_failed');

    const created = await request(app)
      .post('/api/admin/scheduling-v2/classes')
      .set('Cookie', cookie)
      .set('Origin', 'https://admin.templeunderground.com')
      .send(validBody);
    expect(created.status).toBe(200);
    expect(created.body.class.name).toBe('Class 1');
  });
});
