import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME, encryptAdminSession } from '../../lib/adminSession.js';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { createAdminSchedulingV2Router } from './index.js';

const ADMIN_KEY = 'test-admin-key-session-content';
const SESSION_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const OTHER_SESSION_ID = 'cccccccc-3333-4333-8333-333333333333';

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

function createSchedulingFixture() {
  const sessions = new Map();
  const content = new Map();

  function createQuery(table) {
    const state = {
      op: 'select',
      payload: undefined,
      filters: [],
      range: null,
      terminal: null,
    };
    const run = () => (table === 'sessions' ? runSessions(state) : runContent(state));
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
        state.filters.push({ col, val });
        return api;
      },
      order() {
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
    for (const f of filters) next = next.filter((row) => row[f.col] === f.val);
    return next;
  }

  function finish(rows, state) {
    if (state.terminal === 'maybeSingle' || state.terminal === 'single') {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  function runSessions(state) {
    const rows = applyFilters([...sessions.values()], state.filters);
    return finish(rows, state);
  }

  function runContent(state) {
    if (state.op === 'insert') {
      const payload = state.payload;
      if (!sessions.has(payload.session_id)) {
        return {
          data: null,
          error: { code: '23503', message: 'insert or update violates foreign key constraint "session_content_session_id_fkey"' },
        };
      }
      if (content.has(payload.session_id)) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "session_content_session_id_key"' },
        };
      }
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        notes: null,
        video_url: null,
        visibility: 'staff',
        created_at: now,
        updated_at: now,
        ...payload,
      };
      content.set(row.session_id, row);
      return { data: { ...row }, error: null };
    }

    if (state.op === 'update') {
      const sessionFilter = state.filters.find((f) => f.col === 'session_id');
      const existing = sessionFilter ? content.get(sessionFilter.val) : null;
      if (!existing) return { data: null, error: { code: 'PGRST116', message: 'not found' } };
      const updated = { ...existing, ...state.payload, updated_at: new Date().toISOString() };
      content.set(updated.session_id, updated);
      return { data: { ...updated }, error: null };
    }

    if (state.op === 'delete') {
      const sessionFilter = state.filters.find((f) => f.col === 'session_id');
      const existing = sessionFilter ? content.get(sessionFilter.val) : null;
      if (!existing) return { data: null, error: null };
      content.delete(existing.session_id);
      return { data: { ...existing }, error: null };
    }

    let rows = applyFilters([...content.values()], state.filters);
    rows.sort((a, b) => {
      const created = String(a.created_at).localeCompare(String(b.created_at));
      if (created !== 0) return created;
      return String(a.id).localeCompare(String(b.id));
    });
    if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
    return finish(rows, state);
  }

  return {
    from(table) {
      if (table !== 'sessions' && table !== 'session_content') {
        return {
          select() {
            return this;
          },
          then(resolve) {
            return resolve({ data: null, error: { message: `unknown_table:${table}` } });
          },
        };
      }
      return createQuery(table);
    },
    seedSession(id) {
      sessions.set(id, { id });
    },
    contentCount() {
      return content.size;
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

describe('admin scheduling-v2 session content', () => {
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

  it('creates, reads, updates, lists, and deletes content with default staff visibility', async () => {
    const supabase = createSchedulingFixture();
    supabase.seedSession(SESSION_ID);
    supabase.seedSession(OTHER_SESSION_ID);
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const created = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY)
      .send({
        notes: '  Bring a towel  ',
        video_url: 'HTTPS://videos.example.com/class-1',
      });
    expect(created.status).toBe(200);
    expect(created.body.content).toMatchObject({
      session_id: SESSION_ID,
      notes: 'Bring a towel',
      video_url: 'https://videos.example.com/class-1',
      visibility: 'staff',
    });

    const members = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${OTHER_SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ notes: 'MEMBERS-ONLY-NOTE', visibility: 'members' });
    expect(members.status).toBe(200);
    expect(members.body.content.visibility).toBe('members');

    const got = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY);
    expect(got.status).toBe(200);
    expect(got.body.content.notes).toBe('Bring a towel');

    const listed = await request(app)
      .get('/api/admin/scheduling-v2/session-content?visibility=members')
      .set('x-admin-key', ADMIN_KEY);
    expect(listed.status).toBe(200);
    expect(listed.body.rows).toHaveLength(1);
    expect(listed.body.rows[0].notes).toBe('MEMBERS-ONLY-NOTE');

    const patched = await request(app)
      .patch(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ visibility: 'Public', video_url: null });
    expect(patched.status).toBe(200);
    expect(patched.body.content.visibility).toBe('public');
    expect(patched.body.content.video_url).toBeNull();
    expect(patched.body.content.notes).toBe('Bring a towel');

    const duplicate = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ notes: 'again' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ ok: false, error: 'already_exists' });

    const removed = await request(app)
      .delete(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY);
    expect(removed.status).toBe(200);
    expect(removed.body.content.session_id).toBe(SESSION_ID);

    const missing = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ ok: false, error: 'content_not_found' });
    expect(supabase.contentCount()).toBe(1);
  });

  it('rejects non-https video URLs, bad visibility, and unknown sessions', async () => {
    const supabase = createSchedulingFixture();
    supabase.seedSession(SESSION_ID);
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });
    const post = (body, sessionId = SESSION_ID) =>
      request(app)
        .post(`/api/admin/scheduling-v2/sessions/${sessionId}/content`)
        .set('x-admin-key', ADMIN_KEY)
        .send(body);

    expect((await post({ video_url: 'http://videos.example.com/a' })).body).toEqual({
      ok: false,
      error: 'invalid_video_url',
    });
    expect((await post({ video_url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await post({ video_url: 'https://user:pass@videos.example.com/a' })).body.error).toBe(
      'invalid_video_url',
    );
    expect((await post({ notes: 12 })).body.error).toBe('invalid_notes');
    expect((await post({ visibility: 'guests' })).body.error).toBe('invalid_visibility');
    expect((await post({ notes: 'ok' }, 'not-a-uuid')).body.error).toBe('invalid_session_id');

    const missingSession = await post({ notes: 'ok' }, 'dddddddd-4444-4444-8444-444444444444');
    expect(missingSession.status).toBe(404);
    expect(missingSession.body).toEqual({ ok: false, error: 'session_not_found' });

    const emptyPatch = await request(app)
      .patch(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY)
      .send({});
    expect(emptyPatch.status).toBe(404);
    expect(emptyPatch.body.error).toBe('content_not_found');

    await post({ notes: 'kept' });
    const noUpdates = await request(app)
      .patch(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', ADMIN_KEY)
      .send({});
    expect(noUpdates.status).toBe(400);
    expect(noUpdates.body).toEqual({ ok: false, error: 'no_updates' });

    const badPage = await request(app)
      .get('/api/admin/scheduling-v2/session-content?limit=0')
      .set('x-admin-key', ADMIN_KEY);
    expect(badPage.status).toBe(400);
    expect(badPage.body.error).toBe('invalid_pagination');
  });

  it('keeps scheduling RBAC and cookie CSRF on content mutations', async () => {
    const supabase = createSchedulingFixture();
    supabase.seedSession(SESSION_ID);
    const financeApp = createApp({
      requireAdmin: createRequireAdmin({ lookupStaff: async () => financeStaff }),
      supabase,
    });
    const deskApp = createApp({
      requireAdmin: createRequireAdmin({ lookupStaff: async () => deskStaff }),
      supabase,
    });

    const denied = await request(financeApp)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', 'finance-key')
      .send({ notes: 'nope' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('forbidden');

    const financeRead = await request(financeApp)
      .get('/api/admin/scheduling-v2/session-content')
      .set('x-admin-key', 'finance-key');
    expect(financeRead.status).toBe(200);

    const desk = await request(deskApp)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('x-admin-key', 'desk-key')
      .send({ visibility: 'public', video_url: 'https://videos.example.com/desk' });
    expect(desk.status).toBe(200);
    expect(desk.body.content.visibility).toBe('public');
  });

  it('accepts a cookie session and requires a CSRF origin on writes', async () => {
    process.env.SESSION_SECRET = 'y'.repeat(32);
    process.env.ADMIN_EMAIL = 'singh@example.com';
    process.env.ADMIN_ALLOWED_ORIGINS = 'https://admin.templeunderground.com';
    const supabase = createSchedulingFixture();
    supabase.seedSession(SESSION_ID);
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });
    const token = await encryptAdminSession({ email: 'singh@example.com' });
    const cookie = `${ADMIN_SESSION_COOKIE_NAME}=${token}`;

    const missingOrigin = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('Cookie', cookie)
      .send({ notes: 'cookie' });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error).toBe('csrf_failed');

    const created = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`)
      .set('Cookie', cookie)
      .set('Origin', 'https://admin.templeunderground.com')
      .send({ notes: 'cookie' });
    expect(created.status).toBe(200);
    expect(created.body.content.visibility).toBe('staff');

    const unauthenticated = await request(app).get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/content`);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error).toBe('unauthorized');
  });

  it('returns supabase_not_configured when the service-role client is missing', async () => {
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase: null });
    const res = await request(app).get('/api/admin/scheduling-v2/session-content').set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });
});
