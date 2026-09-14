import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { registerAdminSchedulingRoutes } from './scheduling.js';

const ADMIN_KEY = 'api-test-002-admin-key';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';
const PARTICIPANT_ID_B = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444';

/**
 * Isolated in-memory Supabase stand-in for sessions + attendance.
 * Never talks to a network or production database.
 */
function isoDowUtc(dateStr) {
  const jsDay = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function eachUtcDateInclusive(start, end) {
  const dates = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    const next = new Date(`${current}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    current = next.toISOString().slice(0, 10);
  }
  return dates;
}

function normalizeStartTime(value) {
  if (typeof value !== 'string') return value;
  return value.length === 5 ? `${value}:00` : value;
}

function createSchedulingFixture({ canAttend = true, rpcError = null } = {}) {
  const sessions = new Map();
  const templates = new Map();
  const attendance = [];

  function createQuery(table) {
    const state = {
      op: 'select',
      payload: undefined,
      filters: [],
      orderBy: null,
      range: null,
      terminal: null,
    };

    const run = () => {
      if (table === 'sessions') return runSessions(state);
      if (table === 'attendance_records') return runAttendance(state);
      if (table === 'schedule_templates') return runTemplates(state);
      return { data: null, error: { message: `unknown_table:${table}` } };
    };

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
      upsert(payload) {
        state.op = 'upsert';
        state.payload = payload;
        return api;
      },
      eq(col, val) {
        state.filters.push({ op: 'eq', col, val });
        return api;
      },
      gte(col, val) {
        state.filters.push({ op: 'gte', col, val });
        return api;
      },
      lte(col, val) {
        state.filters.push({ op: 'lte', col, val });
        return api;
      },
      is(col, val) {
        state.filters.push({ op: 'is', col, val });
        return api;
      },
      order(col, opts) {
        state.orderBy = { col, opts };
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

  function applySessionFilters(rows, filters) {
    let next = rows;
    for (const f of filters) {
      if (f.op === 'eq') next = next.filter((r) => r[f.col] === f.val);
      if (f.op === 'gte') next = next.filter((r) => r[f.col] >= f.val);
      if (f.op === 'lte') next = next.filter((r) => r[f.col] <= f.val);
      if (f.op === 'is' && f.val === null) next = next.filter((r) => r[f.col] == null);
    }
    return next;
  }

  function runSessions(state) {
    if (state.op === 'insert') {
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        cancelled_at: null,
        created_at: now,
        updated_at: now,
        ...state.payload,
      };
      sessions.set(row.id, row);
      return { data: { ...row }, error: null };
    }

    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f.op === 'eq' && f.col === 'id');
      const existing = idFilter ? sessions.get(idFilter.val) : null;
      if (!existing) return { data: null, error: { message: 'session not found' } };
      const updated = { ...existing, ...state.payload, updated_at: new Date().toISOString() };
      sessions.set(updated.id, updated);
      return { data: { ...updated }, error: null };
    }

    let rows = applySessionFilters([...sessions.values()], state.filters);
    if (state.orderBy?.col === 'starts_at') {
      rows.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    }
    if (state.range) {
      rows = rows.slice(state.range.from, state.range.to + 1);
    }
    if (state.terminal === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null };
    }
    if (state.terminal === 'single') {
      if (!rows[0]) return { data: null, error: { message: 'session not found' } };
      return { data: rows[0], error: null };
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }

  function runAttendance(state) {
    if (state.op === 'upsert') {
      const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
      const upserted = [];
      for (const rec of rows) {
        const idx = attendance.findIndex(
          (a) => a.session_id === rec.session_id && a.participant_id === rec.participant_id,
        );
        const now = new Date().toISOString();
        const row = {
          id: idx >= 0 ? attendance[idx].id : randomUUID(),
          created_at: idx >= 0 ? attendance[idx].created_at : now,
          updated_at: now,
          ...rec,
        };
        if (idx >= 0) attendance[idx] = row;
        else attendance.push(row);
        upserted.push({
          id: row.id,
          participant_id: row.participant_id,
          status: row.status,
          recorded_at: row.recorded_at,
          recorded_by: row.recorded_by,
        });
      }
      return { data: upserted, error: null };
    }

    let rows = [...attendance];
    for (const f of state.filters) {
      if (f.op === 'eq') rows = rows.filter((r) => r[f.col] === f.val);
    }
    if (state.orderBy?.col === 'recorded_at') {
      rows.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }

  function applyTemplateFilters(rows, filters) {
    let next = rows;
    for (const f of filters) {
      if (f.op === 'eq') next = next.filter((r) => r[f.col] === f.val);
    }
    return next;
  }

  function runTemplates(state) {
    if (state.op === 'insert') {
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        is_active: true,
        notes: null,
        created_at: now,
        updated_at: now,
        ...state.payload,
        start_time: normalizeStartTime(state.payload?.start_time),
      };
      templates.set(row.id, row);
      return { data: { ...row }, error: null };
    }

    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f.op === 'eq' && f.col === 'id');
      const existing = idFilter ? templates.get(idFilter.val) : null;
      if (!existing) return { data: null, error: { message: 'template not found' } };
      const updated = {
        ...existing,
        ...state.payload,
        start_time: state.payload?.start_time
          ? normalizeStartTime(state.payload.start_time)
          : existing.start_time,
        updated_at: new Date().toISOString(),
      };
      templates.set(updated.id, updated);
      return { data: { ...updated }, error: null };
    }

    let rows = applyTemplateFilters([...templates.values()], state.filters);
    if (state.orderBy?.col === 'day_of_week') {
      rows.sort((a, b) => a.day_of_week - b.day_of_week || String(a.start_time).localeCompare(String(b.start_time)));
    }
    if (state.range) {
      rows = rows.slice(state.range.from, state.range.to + 1);
    }
    if (state.terminal === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null };
    }
    if (state.terminal === 'single') {
      if (!rows[0]) return { data: null, error: { message: 'template not found' } };
      return { data: rows[0], error: null };
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }

  function runGenerateSessions({ p_start_date, p_end_date, p_template_id } = {}) {
    if (p_template_id) {
      const requested = templates.get(p_template_id);
      if (!requested) return { data: null, error: { message: 'template_not_found' } };
      if (!requested.is_active) return { data: null, error: { message: 'template_inactive' } };
    }

    const candidates = [];
    for (const date of eachUtcDateInclusive(p_start_date, p_end_date)) {
      for (const template of templates.values()) {
        if (!template.is_active) continue;
        if (p_template_id && template.id !== p_template_id) continue;
        if (template.day_of_week !== isoDowUtc(date)) continue;
        const startTime = normalizeStartTime(template.start_time);
        const startsAt = `${date}T${startTime}.000Z`;
        const endsAt = new Date(
          new Date(startsAt).getTime() + template.duration_minutes * 60 * 1000,
        ).toISOString();
        candidates.push({
          starts_at: startsAt,
          ends_at: endsAt,
          schedule_template_id: template.id,
          session_label: template.name,
          notes: template.notes,
        });
      }
    }

    const created = [];
    for (const candidate of candidates) {
      const exists = [...sessions.values()].some(
        (row) =>
          row.schedule_template_id === candidate.schedule_template_id &&
          row.starts_at === candidate.starts_at,
      );
      if (exists) continue;
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        cancelled_at: null,
        created_at: now,
        updated_at: now,
        ...candidate,
      };
      sessions.set(row.id, row);
      created.push({ ...row });
    }

    created.sort(
      (a, b) => String(a.starts_at).localeCompare(String(b.starts_at)) || String(a.id).localeCompare(String(b.id)),
    );

    return {
      data: {
        created_count: created.length,
        skipped_count: candidates.length - created.length,
        created,
      },
      error: null,
    };
  }

  function seedSession(overrides = {}) {
    const row = {
      id: SESSION_ID,
      starts_at: '2026-06-01T19:00:00.000Z',
      ends_at: '2026-06-01T20:00:00.000Z',
      session_label: 'Class 1',
      schedule_template_id: null,
      notes: null,
      cancelled_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      ...overrides,
    };
    sessions.set(row.id, row);
    return row;
  }

  function seedTemplate(overrides = {}) {
    const row = {
      id: TEMPLATE_ID,
      name: 'Class 1',
      day_of_week: 1,
      start_time: '19:00:00',
      duration_minutes: 60,
      is_active: true,
      notes: 'monday class',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      ...overrides,
      start_time: normalizeStartTime(overrides.start_time ?? '19:00:00'),
    };
    templates.set(row.id, row);
    return row;
  }

  const supabase = {
    from(table) {
      return createQuery(table);
    },
    async rpc(name, args) {
      if (name === 'generate_sessions') {
        return runGenerateSessions(args);
      }
      if (name !== 'can_attend_group_session') {
        return { data: null, error: { message: `unknown_rpc:${name}` } };
      }
      if (rpcError) return { data: null, error: rpcError };
      const allowed = typeof canAttend === 'function' ? canAttend(args) : canAttend;
      return { data: allowed, error: null };
    },
  };

  return { supabase, sessions, templates, attendance, seedSession, seedTemplate };
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

function auth(req) {
  return req.set('x-admin-key', ADMIN_KEY);
}

describe('admin scheduling routes', () => {
  let previousAdminKey;

  beforeEach(() => {
    previousAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
  });

  describe('auth', () => {
    it('rejects missing admin key', async () => {
      const { supabase } = createSchedulingFixture();
      const res = await request(createApp(supabase)).get('/api/admin/scheduling/sessions');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
    });

    it('rejects wrong admin key', async () => {
      const { supabase } = createSchedulingFixture();
      const res = await request(createApp(supabase))
        .get('/api/admin/scheduling/sessions')
        .set('x-admin-key', 'wrong-key');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
    });

    it('returns supabase_not_configured when client is missing', async () => {
      const res = await auth(request(createApp(null)).get('/api/admin/scheduling/sessions'));
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
    });
  });

  describe('list sessions', () => {
    it('rejects invalid start and end dates', async () => {
      const { supabase } = createSchedulingFixture();
      const app = createApp(supabase);

      const start = await auth(request(app).get('/api/admin/scheduling/sessions').query({ start: '06-01-2026' }));
      expect(start.status).toBe(400);
      expect(start.body).toEqual({ ok: false, error: 'invalid_start' });

      const end = await auth(request(app).get('/api/admin/scheduling/sessions').query({ end: '2026-02-30' }));
      expect(end.status).toBe(400);
      expect(end.body).toEqual({ ok: false, error: 'invalid_end' });
    });

    it('lists sessions and hides cancelled rows by default', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession();
      fixture.seedSession({
        id: '55555555-5555-4555-8555-555555555555',
        starts_at: '2026-06-02T19:00:00.000Z',
        ends_at: '2026-06-02T20:00:00.000Z',
        session_label: 'Class 2',
        cancelled_at: '2026-06-02T12:00:00.000Z',
      });
      const app = createApp(fixture.supabase);

      const listed = await auth(request(app).get('/api/admin/scheduling/sessions'));
      expect(listed.status).toBe(200);
      expect(listed.body.ok).toBe(true);
      expect(listed.body.rowCount).toBe(1);
      expect(listed.body.rows).toHaveLength(1);
      expect(listed.body.rows[0].id).toBe(SESSION_ID);

      const withCancelled = await auth(
        request(app).get('/api/admin/scheduling/sessions').query({ include_cancelled: 'true' }),
      );
      expect(withCancelled.status).toBe(200);
      expect(withCancelled.body.rowCount).toBe(2);
    });

    it('filters by date range and session label', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession();
      fixture.seedSession({
        id: '66666666-6666-4666-8666-666666666666',
        starts_at: '2026-07-01T19:00:00.000Z',
        ends_at: '2026-07-01T20:00:00.000Z',
        session_label: 'Open Mat',
      });
      const app = createApp(fixture.supabase);

      const byDate = await auth(
        request(app).get('/api/admin/scheduling/sessions').query({ start: '2026-06-01', end: '2026-06-01' }),
      );
      expect(byDate.status).toBe(200);
      expect(byDate.body.rows.map((r) => r.id)).toEqual([SESSION_ID]);

      const byLabel = await auth(
        request(app).get('/api/admin/scheduling/sessions').query({ session_label: 'Open Mat' }),
      );
      expect(byLabel.status).toBe(200);
      expect(byLabel.body.rows).toHaveLength(1);
      expect(byLabel.body.rows[0].session_label).toBe('Open Mat');
    });
  });

  describe('get session', () => {
    it('rejects invalid session UUID', async () => {
      const { supabase } = createSchedulingFixture();
      const res = await auth(request(createApp(supabase)).get('/api/admin/scheduling/sessions/not-a-uuid'));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: 'invalid_session_id' });
    });

    it('returns 404 when the session is missing', async () => {
      const { supabase } = createSchedulingFixture();
      const res = await auth(request(createApp(supabase)).get(`/api/admin/scheduling/sessions/${SESSION_ID}`));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ ok: false, error: 'session_not_found' });
    });

    it('returns the session and attendance rows', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession();
      fixture.attendance.push({
        id: '77777777-7777-4777-8777-777777777777',
        session_id: SESSION_ID,
        participant_id: PARTICIPANT_ID,
        status: 'present',
        recorded_at: '2026-06-01T19:05:00.000Z',
        recorded_by: 'front-desk',
        created_at: '2026-06-01T19:05:00.000Z',
        updated_at: '2026-06-01T19:05:00.000Z',
      });
      const res = await auth(request(createApp(fixture.supabase)).get(`/api/admin/scheduling/sessions/${SESSION_ID}`));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.session.id).toBe(SESSION_ID);
      expect(res.body.attendance).toHaveLength(1);
      expect(res.body.attendance[0].participant_id).toBe(PARTICIPANT_ID);
    });
  });

  describe('create session', () => {
    it('rejects invalid datetimes and inverted range', async () => {
      const { supabase } = createSchedulingFixture();
      const app = createApp(supabase);

      const missingStart = await auth(request(app).post('/api/admin/scheduling/sessions').send({ ends_at: '2026-06-01T20:00:00.000Z' }));
      expect(missingStart.status).toBe(400);
      expect(missingStart.body).toEqual({ ok: false, error: 'invalid_starts_at' });

      const badEnd = await auth(
        request(app)
          .post('/api/admin/scheduling/sessions')
          .send({ starts_at: '2026-06-01T19:00:00.000Z', ends_at: 'not-a-date' }),
      );
      expect(badEnd.status).toBe(400);
      expect(badEnd.body).toEqual({ ok: false, error: 'invalid_ends_at' });

      const inverted = await auth(
        request(app)
          .post('/api/admin/scheduling/sessions')
          .send({ starts_at: '2026-06-01T20:00:00.000Z', ends_at: '2026-06-01T19:00:00.000Z' }),
      );
      expect(inverted.status).toBe(400);
      expect(inverted.body).toEqual({ ok: false, error: 'ends_at_must_be_after_starts_at' });
    });

    it('rejects invalid schedule_template_id', async () => {
      const { supabase } = createSchedulingFixture();
      const res = await auth(
        request(createApp(supabase))
          .post('/api/admin/scheduling/sessions')
          .send({
            starts_at: '2026-06-01T19:00:00.000Z',
            ends_at: '2026-06-01T20:00:00.000Z',
            schedule_template_id: 'not-a-uuid',
          }),
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: 'invalid_schedule_template_id' });
    });

    it('creates a session and lists it', async () => {
      const fixture = createSchedulingFixture();
      const app = createApp(fixture.supabase);

      const created = await auth(
        request(app)
          .post('/api/admin/scheduling/sessions')
          .send({
            starts_at: '2026-06-01T19:00:00.000Z',
            ends_at: '2026-06-01T20:30:00.000Z',
            session_label: 'Class 1',
            schedule_template_id: TEMPLATE_ID,
            notes: 'first class',
          }),
      );
      expect(created.status).toBe(200);
      expect(created.body.ok).toBe(true);
      expect(created.body.session.session_label).toBe('Class 1');
      expect(created.body.session.schedule_template_id).toBe(TEMPLATE_ID);
      expect(created.body.session.cancelled_at).toBeNull();
      expect(created.body.session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const listed = await auth(request(app).get('/api/admin/scheduling/sessions'));
      expect(listed.status).toBe(200);
      expect(listed.body.rowCount).toBe(1);
      expect(listed.body.rows[0].id).toBe(created.body.session.id);
    });
  });

  describe('cancel session', () => {
    it('soft-cancels with cancel:true and rejects empty patches', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession();
      const app = createApp(fixture.supabase);

      const empty = await auth(request(app).patch(`/api/admin/scheduling/sessions/${SESSION_ID}`).send({}));
      expect(empty.status).toBe(400);
      expect(empty.body).toEqual({ ok: false, error: 'no_updates' });

      const cancelled = await auth(
        request(app).patch(`/api/admin/scheduling/sessions/${SESSION_ID}`).send({ cancel: true }),
      );
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.ok).toBe(true);
      expect(cancelled.body.session.cancelled_at).toBeTruthy();

      const listed = await auth(request(app).get('/api/admin/scheduling/sessions'));
      expect(listed.body.rowCount).toBe(0);
    });

    it('rejects invalid patch dates and unknown ids', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession();
      const app = createApp(fixture.supabase);

      const badDate = await auth(
        request(app).patch(`/api/admin/scheduling/sessions/${SESSION_ID}`).send({ starts_at: 'nope' }),
      );
      expect(badDate.status).toBe(400);
      expect(badDate.body).toEqual({ ok: false, error: 'invalid_starts_at' });

      const missing = await auth(
        request(app)
          .patch('/api/admin/scheduling/sessions/88888888-8888-4888-8888-888888888888')
          .send({ cancel: true }),
      );
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ ok: false, error: 'session_not_found' });
    });
  });

  describe('attendance upsert', () => {
    it('rejects invalid session id, empty records, and invalid participant UUID', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession();
      const app = createApp(fixture.supabase);

      const badId = await auth(request(app).post('/api/admin/scheduling/sessions/not-a-uuid/attendance').send({ records: [] }));
      expect(badId.status).toBe(400);
      expect(badId.body).toEqual({ ok: false, error: 'invalid_session_id' });

      const empty = await auth(
        request(app).post(`/api/admin/scheduling/sessions/${SESSION_ID}/attendance`).send({ records: [] }),
      );
      expect(empty.status).toBe(400);
      expect(empty.body).toEqual({ ok: false, error: 'records_required' });

      const badParticipant = await auth(
        request(app)
          .post(`/api/admin/scheduling/sessions/${SESSION_ID}/attendance`)
          .send({ records: [{ participant_id: 'not-a-uuid', status: 'present' }] }),
      );
      expect(badParticipant.status).toBe(400);
      expect(badParticipant.body).toEqual({ ok: false, error: 'invalid_participant_id' });
    });

    it('returns 404 for unknown session and 400 when cancelled', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedSession({ cancelled_at: '2026-06-01T12:00:00.000Z' });
      const app = createApp(fixture.supabase);

      const cancelled = await auth(
        request(app)
          .post(`/api/admin/scheduling/sessions/${SESSION_ID}/attendance`)
          .send({ records: [{ participant_id: PARTICIPANT_ID, status: 'present' }], enforce_entitlement: false }),
      );
      expect(cancelled.status).toBe(400);
      expect(cancelled.body).toEqual({ ok: false, error: 'session_cancelled' });

      const missing = await auth(
        request(app)
          .post('/api/admin/scheduling/sessions/88888888-8888-4888-8888-888888888888/attendance')
          .send({ records: [{ participant_id: PARTICIPANT_ID, status: 'no_show' }] }),
      );
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ ok: false, error: 'session_not_found' });
    });

    it('upserts attendance and returns blocked entitlement rows', async () => {
      const fixture = createSchedulingFixture({
        canAttend: (args) => args.p_participant_id === PARTICIPANT_ID,
      });
      fixture.seedSession();
      const app = createApp(fixture.supabase);

      const mixed = await auth(
        request(app)
          .post(`/api/admin/scheduling/sessions/${SESSION_ID}/attendance`)
          .send({
            records: [
              { participant_id: PARTICIPANT_ID, status: 'present', recorded_by: 'desk' },
              { participant_id: PARTICIPANT_ID_B, status: 'present' },
            ],
            recorded_by: 'admin_api',
          }),
      );
      expect(mixed.status).toBe(200);
      expect(mixed.body.ok).toBe(true);
      expect(mixed.body.session_id).toBe(SESSION_ID);
      expect(mixed.body.upserted).toHaveLength(1);
      expect(mixed.body.upserted[0].participant_id).toBe(PARTICIPANT_ID);
      expect(mixed.body.upserted[0].status).toBe('present');
      expect(mixed.body.upserted[0].recorded_by).toBe('desk');
      expect(mixed.body.blocked).toEqual([{ participant_id: PARTICIPANT_ID_B, reason: 'no_group_entitlement' }]);

      const detail = await auth(request(app).get(`/api/admin/scheduling/sessions/${SESSION_ID}`));
      expect(detail.body.attendance).toHaveLength(1);
    });

    it('returns all_records_blocked when every present row fails entitlement', async () => {
      const fixture = createSchedulingFixture({ canAttend: false });
      fixture.seedSession();
      const res = await auth(
        request(createApp(fixture.supabase))
          .post(`/api/admin/scheduling/sessions/${SESSION_ID}/attendance`)
          .send({ records: [{ participant_id: PARTICIPANT_ID, status: 'present' }] }),
      );
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe('all_records_blocked');
      expect(res.body.blocked).toEqual([{ participant_id: PARTICIPANT_ID, reason: 'no_group_entitlement' }]);
    });

    it('skips entitlement checks when enforce_entitlement is false', async () => {
      const fixture = createSchedulingFixture({ canAttend: false });
      fixture.seedSession();
      const res = await auth(
        request(createApp(fixture.supabase))
          .post(`/api/admin/scheduling/sessions/${SESSION_ID}/attendance`)
          .send({
            records: [{ participant_id: PARTICIPANT_ID, status: 'present' }],
            enforce_entitlement: false,
          }),
      );
      expect(res.status).toBe(200);
      expect(res.body.upserted).toHaveLength(1);
      expect(res.body.blocked).toEqual([]);
    });
  });

  describe('schedule templates', () => {
    const validTemplate = {
      name: 'Class 1',
      day_of_week: 1,
      start_time: '19:00',
      duration_minutes: 60,
      notes: 'monday class',
    };

    it('creates and lists a template, then updates it', async () => {
      const fixture = createSchedulingFixture();
      const app = createApp(fixture.supabase);

      const created = await auth(request(app).post('/api/admin/scheduling/templates').send(validTemplate));
      expect(created.status).toBe(200);
      expect(created.body.ok).toBe(true);
      expect(created.body.template.name).toBe('Class 1');
      expect(created.body.template.day_of_week).toBe(1);
      expect(created.body.template.start_time).toBe('19:00:00');
      expect(created.body.template.duration_minutes).toBe(60);
      expect(created.body.template.is_active).toBe(true);
      expect(created.body.template.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const listed = await auth(request(app).get('/api/admin/scheduling/templates'));
      expect(listed.status).toBe(200);
      expect(listed.body.ok).toBe(true);
      expect(listed.body.rowCount).toBe(1);
      expect(listed.body.rows[0].id).toBe(created.body.template.id);

      const updated = await auth(
        request(app)
          .patch(`/api/admin/scheduling/templates/${created.body.template.id}`)
          .send({ name: 'Class 1 Evening', duration_minutes: 90, is_active: true }),
      );
      expect(updated.status).toBe(200);
      expect(updated.body.ok).toBe(true);
      expect(updated.body.template.name).toBe('Class 1 Evening');
      expect(updated.body.template.duration_minutes).toBe(90);

      const detail = await auth(
        request(app).get(`/api/admin/scheduling/templates/${created.body.template.id}`),
      );
      expect(detail.status).toBe(200);
      expect(detail.body.template.name).toBe('Class 1 Evening');
    });

    it('hides inactive templates unless include_inactive=true', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate();
      fixture.seedTemplate({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Retired',
        is_active: false,
      });
      const app = createApp(fixture.supabase);

      const activeOnly = await auth(request(app).get('/api/admin/scheduling/templates'));
      expect(activeOnly.status).toBe(200);
      expect(activeOnly.body.rowCount).toBe(1);
      expect(activeOnly.body.rows[0].id).toBe(TEMPLATE_ID);

      const all = await auth(
        request(app).get('/api/admin/scheduling/templates').query({ include_inactive: 'true' }),
      );
      expect(all.status).toBe(200);
      expect(all.body.rowCount).toBe(2);
    });

    it('rejects validation errors on create and update', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate();
      const app = createApp(fixture.supabase);

      const missingName = await auth(
        request(app).post('/api/admin/scheduling/templates').send({ ...validTemplate, name: '  ' }),
      );
      expect(missingName.status).toBe(400);
      expect(missingName.body).toEqual({ ok: false, error: 'name_required' });

      const badDay = await auth(
        request(app).post('/api/admin/scheduling/templates').send({ ...validTemplate, day_of_week: 0 }),
      );
      expect(badDay.status).toBe(400);
      expect(badDay.body).toEqual({ ok: false, error: 'invalid_day_of_week' });

      const badTime = await auth(
        request(app).post('/api/admin/scheduling/templates').send({ ...validTemplate, start_time: '25:00' }),
      );
      expect(badTime.status).toBe(400);
      expect(badTime.body).toEqual({ ok: false, error: 'invalid_start_time' });

      const badDuration = await auth(
        request(app)
          .post('/api/admin/scheduling/templates')
          .send({ ...validTemplate, duration_minutes: 0 }),
      );
      expect(badDuration.status).toBe(400);
      expect(badDuration.body).toEqual({ ok: false, error: 'invalid_duration_minutes' });

      const emptyPatch = await auth(
        request(app).patch(`/api/admin/scheduling/templates/${TEMPLATE_ID}`).send({}),
      );
      expect(emptyPatch.status).toBe(400);
      expect(emptyPatch.body).toEqual({ ok: false, error: 'no_updates' });

      const missing = await auth(
        request(app)
          .patch('/api/admin/scheduling/templates/88888888-8888-4888-8888-888888888888')
          .send({ name: 'Nope' }),
      );
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ ok: false, error: 'template_not_found' });

      const badId = await auth(
        request(app).get('/api/admin/scheduling/templates/not-a-uuid'),
      );
      expect(badId.status).toBe(400);
      expect(badId.body).toEqual({ ok: false, error: 'invalid_template_id' });
    });

    it('requires an admin key for template writes', async () => {
      const { supabase } = createSchedulingFixture();
      const res = await request(createApp(supabase))
        .post('/api/admin/scheduling/templates')
        .send(validTemplate);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
    });
  });

  describe('generate sessions', () => {
    it('expands active templates across a date range', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate();
      fixture.seedTemplate({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Friday Open Mat',
        day_of_week: 5,
        start_time: '18:00:00',
        duration_minutes: 90,
        notes: null,
      });
      const app = createApp(fixture.supabase);

      // 2026-06-01 Monday through 2026-06-07 Sunday: one Monday + one Friday.
      const generated = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-06-01', end: '2026-06-07' }),
      );
      expect(generated.status).toBe(200);
      expect(generated.body.ok).toBe(true);
      expect(generated.body.created_count).toBe(2);
      expect(generated.body.skipped_count).toBe(0);
      expect(generated.body.created).toHaveLength(2);
      expect(generated.body.created.map((row) => row.session_label).sort()).toEqual([
        'Class 1',
        'Friday Open Mat',
      ]);
      const monday = generated.body.created.find((row) => row.schedule_template_id === TEMPLATE_ID);
      expect(monday.starts_at).toBe('2026-06-01T19:00:00.000Z');
      expect(monday.ends_at).toBe('2026-06-01T20:00:00.000Z');
      expect(monday.cancelled_at).toBeNull();

      const listed = await auth(
        request(app).get('/api/admin/scheduling/sessions').query({ start: '2026-06-01', end: '2026-06-07' }),
      );
      expect(listed.status).toBe(200);
      expect(listed.body.rowCount).toBe(2);
    });

    it('does not duplicate sessions when the same range is generated twice', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate();
      const app = createApp(fixture.supabase);
      const body = { start: '2026-06-01', end: '2026-06-07', template_id: TEMPLATE_ID };

      const first = await auth(request(app).post('/api/admin/scheduling/generate-sessions').send(body));
      expect(first.status).toBe(200);
      expect(first.body.created_count).toBe(1);
      expect(first.body.skipped_count).toBe(0);
      const firstId = first.body.created[0].id;

      const second = await auth(request(app).post('/api/admin/scheduling/generate-sessions').send(body));
      expect(second.status).toBe(200);
      expect(second.body.ok).toBe(true);
      expect(second.body.created_count).toBe(0);
      expect(second.body.skipped_count).toBe(1);
      expect(second.body.created).toEqual([]);

      const listed = await auth(request(app).get('/api/admin/scheduling/sessions'));
      expect(listed.body.rowCount).toBe(1);
      expect(listed.body.rows[0].id).toBe(firstId);
    });

    it('skips a cancelled occurrence instead of inserting a second session', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate();
      fixture.seedSession({
        schedule_template_id: TEMPLATE_ID,
        starts_at: '2026-06-01T19:00:00.000Z',
        ends_at: '2026-06-01T20:00:00.000Z',
        cancelled_at: '2026-06-01T12:00:00.000Z',
      });
      const app = createApp(fixture.supabase);

      const generated = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-06-01', end: '2026-06-01', template_id: TEMPLATE_ID }),
      );
      expect(generated.status).toBe(200);
      expect(generated.body.created_count).toBe(0);
      expect(generated.body.skipped_count).toBe(1);
      expect(fixture.sessions.size).toBe(1);
    });

    it('rejects invalid generate payloads', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate();
      const app = createApp(fixture.supabase);

      const missingStart = await auth(
        request(app).post('/api/admin/scheduling/generate-sessions').send({ end: '2026-06-07' }),
      );
      expect(missingStart.status).toBe(400);
      expect(missingStart.body).toEqual({ ok: false, error: 'invalid_start' });

      const inverted = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-06-07', end: '2026-06-01' }),
      );
      expect(inverted.status).toBe(400);
      expect(inverted.body).toEqual({ ok: false, error: 'end_must_be_on_or_after_start' });

      const tooLong = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-01-01', end: '2027-01-03' }),
      );
      expect(tooLong.status).toBe(400);
      expect(tooLong.body).toEqual({ ok: false, error: 'range_too_long' });

      const badTemplate = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-06-01', end: '2026-06-07', template_id: 'not-a-uuid' }),
      );
      expect(badTemplate.status).toBe(400);
      expect(badTemplate.body).toEqual({ ok: false, error: 'invalid_template_id' });

      const missingTemplate = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({
            start: '2026-06-01',
            end: '2026-06-07',
            template_id: '88888888-8888-4888-8888-888888888888',
          }),
      );
      expect(missingTemplate.status).toBe(404);
      expect(missingTemplate.body).toEqual({ ok: false, error: 'template_not_found' });
    });

    it('does not generate from inactive templates unless they are reactivated', async () => {
      const fixture = createSchedulingFixture();
      fixture.seedTemplate({ is_active: false });
      const app = createApp(fixture.supabase);

      const inactive = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-06-01', end: '2026-06-07', template_id: TEMPLATE_ID }),
      );
      expect(inactive.status).toBe(400);
      expect(inactive.body).toEqual({ ok: false, error: 'template_inactive' });

      const none = await auth(
        request(app)
          .post('/api/admin/scheduling/generate-sessions')
          .send({ start: '2026-06-01', end: '2026-06-07' }),
      );
      expect(none.status).toBe(200);
      expect(none.body.created_count).toBe(0);
      expect(fixture.sessions.size).toBe(0);
    });
  });
});
