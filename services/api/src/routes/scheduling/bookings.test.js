import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { ADMIN_SESSION_COOKIE_NAME, encryptAdminSession } from '../../lib/adminSession.js';
import { createAdminSchedulingV2Router } from './index.js';

const ADMIN_KEY = 'test-admin-key-bookings';
const SESSION_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const CLASS_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const PAT_1 = 'cccccccc-3333-4333-8333-333333333331';
const PAT_2 = 'cccccccc-3333-4333-8333-333333333332';
const PAT_3 = 'cccccccc-3333-4333-8333-333333333333';
const PAT_4 = 'cccccccc-3333-4333-8333-333333333334';
const MISSING_SESSION = 'dddddddd-4444-4444-8444-444444444444';
const MISSING_PARTICIPANT = 'eeeeeeee-5555-4555-8555-555555555555';

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

const LATE_CANCEL_MS = 3 * 60 * 60 * 1000;
const OCCUPYING = new Set(['booked', 'attended', 'no_show']);
const ACTIVE = new Set(['booked', 'waitlisted', 'attended', 'no_show']);

function rpcError(message) {
  return { data: null, error: { message } };
}

function nowIso() {
  return new Date().toISOString();
}

function createBookingFixture() {
  const sessions = new Map();
  const classes = new Map();
  const participants = new Map();
  const bookings = new Map();

  function clone(row) {
    return row ? { ...row } : null;
  }

  function occupyingCount(sessionId) {
    return [...bookings.values()].filter(
      (row) => row.session_id === sessionId && OCCUPYING.has(row.status),
    ).length;
  }

  function effectiveCapacity(session) {
    if (session.capacity != null) return session.capacity;
    if (session.class_id) {
      const klass = classes.get(session.class_id);
      if (klass?.capacity != null) return klass.capacity;
    }
    return null;
  }

  function bookSession({ p_session_id, p_participant_id, p_actor }) {
    const session = sessions.get(p_session_id);
    if (!session) return rpcError('session_not_found');
    if (session.cancelled_at) return rpcError('booking_closed');
    if (!participants.get(p_participant_id)) return rpcError('participant_not_found');
    const duplicate = [...bookings.values()].find(
      (row) =>
        row.session_id === p_session_id &&
        row.participant_id === p_participant_id &&
        ACTIVE.has(row.status),
    );
    if (duplicate) return rpcError('already_booked');
    const capacity = effectiveCapacity(session);
    if (capacity == null) return rpcError('capacity_not_configured');
    const status = occupyingCount(p_session_id) < capacity ? 'booked' : 'waitlisted';
    const now = nowIso();
    const row = {
      id: randomUUID(),
      session_id: p_session_id,
      participant_id: p_participant_id,
      status,
      created_at: now,
      updated_at: now,
      cancelled_at: null,
      checked_in_at: null,
      no_show_at: null,
      promoted_at: null,
      created_by: p_actor ?? null,
      cancelled_by: null,
      checked_in_by: null,
      no_show_by: null,
    };
    bookings.set(row.id, row);
    return { data: clone(row), error: null };
  }

  function cancelBooking({ p_booking_id, p_actor }) {
    const row = bookings.get(p_booking_id);
    if (!row) return rpcError('booking_not_found');
    if (row.status === 'cancelled' || row.status === 'late_cancelled') {
      return { data: { booking: clone(row), promoted: null }, error: null };
    }
    if (row.status === 'attended' || row.status === 'no_show') return rpcError('not_booked');
    const session = sessions.get(row.session_id);
    if (!session) return rpcError('session_not_found');
    const now = new Date();
    const startsAt = new Date(session.starts_at);
    const status = now.getTime() >= startsAt.getTime() - LATE_CANCEL_MS ? 'late_cancelled' : 'cancelled';
    const wasOccupying = OCCUPYING.has(row.status);
    const updated = {
      ...row,
      status,
      cancelled_at: now.toISOString(),
      cancelled_by: p_actor ?? null,
      updated_at: now.toISOString(),
    };
    bookings.set(row.id, updated);

    let promoted = null;
    if (wasOccupying) {
      const capacity = effectiveCapacity(session);
      if (capacity != null) {
        const waitlisted = [...bookings.values()]
          .filter((b) => b.session_id === session.id && b.status === 'waitlisted')
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
        if (occupyingCount(session.id) < capacity && waitlisted[0]) {
          const next = {
            ...waitlisted[0],
            status: 'booked',
            promoted_at: now.toISOString(),
            updated_at: now.toISOString(),
          };
          bookings.set(next.id, next);
          promoted = next;
        }
      }
    }
    return { data: { booking: clone(updated), promoted: clone(promoted) }, error: null };
  }

  function checkIn({ p_booking_id, p_actor }) {
    const row = bookings.get(p_booking_id);
    if (!row) return rpcError('booking_not_found');
    if (row.status === 'attended') return { data: clone(row), error: null };
    if (row.status !== 'booked') return rpcError('not_booked');
    const now = nowIso();
    const updated = {
      ...row,
      status: 'attended',
      checked_in_at: now,
      checked_in_by: p_actor ?? null,
      updated_at: now,
    };
    bookings.set(row.id, updated);
    return { data: clone(updated), error: null };
  }

  function markNoShow({ p_booking_id, p_actor }) {
    const row = bookings.get(p_booking_id);
    if (!row) return rpcError('booking_not_found');
    if (row.status === 'no_show') return { data: clone(row), error: null };
    if (row.status !== 'booked') return rpcError('not_booked');
    const session = sessions.get(row.session_id);
    if (!session) return rpcError('session_not_found');
    if (new Date().getTime() < new Date(session.starts_at).getTime()) return rpcError('booking_closed');
    const now = nowIso();
    const updated = {
      ...row,
      status: 'no_show',
      no_show_at: now,
      no_show_by: p_actor ?? null,
      updated_at: now,
    };
    bookings.set(row.id, updated);
    return { data: clone(updated), error: null };
  }

  function createQuery(table) {
    const state = {
      op: 'select',
      filters: [],
      orders: [],
      range: null,
      terminal: null,
    };

    function rowsFor() {
      if (table === 'sessions') return [...sessions.values()];
      if (table === 'classes') return [...classes.values()];
      if (table === 'participants') return [...participants.values()];
      if (table === 'bookings') return [...bookings.values()];
      return [];
    }

    function applyFilters(rows) {
      let next = rows;
      for (const f of state.filters) {
        if (f.op === 'eq') next = next.filter((r) => r[f.col] === f.val);
        if (f.op === 'in') next = next.filter((r) => f.val.includes(r[f.col]));
      }
      return next;
    }

    const run = () => {
      if (table !== 'sessions' && table !== 'classes' && table !== 'participants' && table !== 'bookings') {
        return { data: null, error: { message: `unknown_table:${table}` } };
      }
      let rows = applyFilters(rowsFor());
      for (const order of state.orders) {
        rows.sort((a, b) => {
          const cmp = String(a[order.col] ?? '').localeCompare(String(b[order.col] ?? ''));
          return order.opts?.ascending === false ? -cmp : cmp;
        });
      }
      if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
      if (state.terminal === 'maybeSingle' || state.terminal === 'single') {
        return { data: rows[0] ? clone(rows[0]) : null, error: null };
      }
      return { data: rows.map(clone), error: null };
    };

    const api = {
      select() {
        return api;
      },
      eq(col, val) {
        state.filters.push({ op: 'eq', col, val });
        return api;
      },
      in(col, val) {
        state.filters.push({ op: 'in', col, val });
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

  return {
    from(table) {
      return createQuery(table);
    },
    async rpc(name, args) {
      if (name === 'book_session') return bookSession(args);
      if (name === 'cancel_booking') return cancelBooking(args);
      if (name === 'check_in_booking') return checkIn(args);
      if (name === 'mark_booking_no_show') return markNoShow(args);
      return rpcError(`unknown_rpc:${name}`);
    },
    seedClass(row = {}) {
      classes.set(CLASS_ID, {
        id: CLASS_ID,
        name: 'Class 1',
        capacity: 2,
        ...row,
      });
    },
    seedSession(row = {}) {
      sessions.set(row.id ?? SESSION_ID, {
        id: SESSION_ID,
        starts_at: '2027-06-01T23:00:00.000Z',
        ends_at: '2027-06-02T00:30:00.000Z',
        session_label: 'Class 1',
        class_id: CLASS_ID,
        capacity: null,
        cancelled_at: null,
        ...row,
      });
    },
    seedParticipant(id, name = 'Pat') {
      participants.set(id, { id, full_name: name, email: `${id.slice(0, 8)}@example.com` });
    },
    seedDefaultRoster() {
      this.seedClass();
      this.seedSession();
      this.seedParticipant(PAT_1, 'Pat One');
      this.seedParticipant(PAT_2, 'Pat Two');
      this.seedParticipant(PAT_3, 'Pat Three');
      this.seedParticipant(PAT_4, 'Pat Four');
    },
    bookings,
    sessions,
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

describe('admin scheduling-v2 bookings', () => {
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
    vi.useRealTimers();
    process.env.ADMIN_API_KEY = previousAdminKey;
    process.env.SESSION_SECRET = previousSessionSecret;
    process.env.ADMIN_EMAIL = previousAdminEmail;
    process.env.ADMIN_ALLOWED_ORIGINS = previousAdminAllowedOrigins;
  });

  it('lists an empty roster and books until the waitlist', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const empty = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      ok: true,
      session_id: SESSION_ID,
      capacity: 2,
      occupied_count: 0,
      booked_count: 0,
      waitlist_count: 0,
      rowCount: 0,
    });
    expect(empty.body.rows).toEqual([]);

    const first = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    expect(first.status).toBe(200);
    expect(first.body.booking.status).toBe('booked');
    expect(first.body.booking.created_by).toBe('legacy_shared_key');

    const second = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_2 });
    expect(second.body.booking.status).toBe('booked');

    const waitlisted = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_3 });
    expect(waitlisted.status).toBe(200);
    expect(waitlisted.body.booking.status).toBe('waitlisted');

    const fourth = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_4 });
    expect(fourth.body.booking.status).toBe('waitlisted');

    const roster = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY);
    expect(roster.status).toBe(200);
    expect(roster.body.capacity).toBe(2);
    expect(roster.body.booked_count).toBe(2);
    expect(roster.body.waitlist_count).toBe(2);
    expect(roster.body.occupied_count).toBe(2);
    expect(roster.body.rows.map((row) => row.status)).toEqual([
      'booked',
      'booked',
      'waitlisted',
      'waitlisted',
    ]);
    expect(roster.body.rows[0].participant).toEqual({
      id: PAT_1,
      full_name: 'Pat One',
      email: `${PAT_1.slice(0, 8)}@example.com`,
    });
    expect(roster.body.rows[0]).not.toHaveProperty('date_of_birth');
  });

  it('rejects duplicate active bookings', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const first = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    expect(first.status).toBe(200);

    const dup = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ ok: false, error: 'already_booked' });
  });

  it('promotes the oldest waitlisted booking when a booked spot is cancelled', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const booked = [];
    for (const participantId of [PAT_1, PAT_2, PAT_3, PAT_4]) {
      const res = await request(app)
        .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
        .set('x-admin-key', ADMIN_KEY)
        .send({ participant_id: participantId });
      booked.push(res.body.booking);
    }

    const cancelled = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${booked[0].id}/cancel`)
      .set('x-admin-key', ADMIN_KEY);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.booking.status).toBe('cancelled');
    expect(cancelled.body.promoted.status).toBe('booked');
    expect(cancelled.body.promoted.participant_id).toBe(PAT_3);
    expect(cancelled.body.promoted.promoted_at).toBeTruthy();

    const roster = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY);
    expect(roster.body.booked_count).toBe(2);
    expect(roster.body.waitlist_count).toBe(1);
    expect(roster.body.rows.find((row) => row.participant_id === PAT_4).status).toBe('waitlisted');
  });

  it('marks late_cancelled at exactly 3 elapsed hours, including a DST-adjacent start', async () => {
    const supabase = createBookingFixture();
    supabase.seedClass();
    // 2026-11-01 02:30 EST after fall-back = 07:30 UTC. Naive local 02:30-3h is 03:30 UTC.
    supabase.seedSession({
      starts_at: '2026-11-01T07:30:00.000Z',
      ends_at: '2026-11-01T09:00:00.000Z',
    });
    supabase.seedParticipant(PAT_1, 'Dst One');
    supabase.seedParticipant(PAT_2, 'Dst Two');
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));

    const first = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    const second = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_2 });

    vi.setSystemTime(new Date('2026-11-01T04:29:59.999Z'));
    const early = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${first.body.booking.id}/cancel`)
      .set('x-admin-key', ADMIN_KEY);
    expect(early.status).toBe(200);
    expect(early.body.booking.status).toBe('cancelled');

    vi.setSystemTime(new Date('2026-11-01T04:30:00.000Z'));
    const atBoundary = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${second.body.booking.id}/cancel`)
      .set('x-admin-key', ADMIN_KEY);
    expect(atBoundary.status).toBe(200);
    expect(atBoundary.body.booking.status).toBe('late_cancelled');
  });

  it('checks in a booked row and rejects waitlist check-in', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const booked = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_2 });
    const waitlisted = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_3 });

    const checkedIn = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${booked.body.booking.id}/check-in`)
      .set('x-admin-key', ADMIN_KEY);
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body.booking.status).toBe('attended');
    expect(checkedIn.body.booking.checked_in_at).toBeTruthy();

    const waitlistCheckIn = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${waitlisted.body.booking.id}/check-in`)
      .set('x-admin-key', ADMIN_KEY);
    expect(waitlistCheckIn.status).toBe(409);
    expect(waitlistCheckIn.body).toEqual({ ok: false, error: 'not_booked' });
  });

  it('marks no-show after the session starts and rejects it before', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-05-01T12:00:00.000Z'));
    const booked = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });

    const early = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${booked.body.booking.id}/no-show`)
      .set('x-admin-key', ADMIN_KEY);
    expect(early.status).toBe(409);
    expect(early.body).toEqual({ ok: false, error: 'booking_closed' });

    vi.setSystemTime(new Date('2027-06-01T23:00:00.000Z'));
    const marked = await request(app)
      .post(`/api/admin/scheduling-v2/bookings/${booked.body.booking.id}/no-show`)
      .set('x-admin-key', ADMIN_KEY);
    expect(marked.status).toBe(200);
    expect(marked.body.booking.status).toBe('no_show');
    expect(marked.body.booking.no_show_at).toBe('2027-06-01T23:00:00.000Z');
  });

  it('uses session capacity over class capacity and rejects unconfigured capacity', async () => {
    const supabase = createBookingFixture();
    supabase.seedClass({ capacity: 8 });
    supabase.seedSession({ capacity: 1 });
    supabase.seedParticipant(PAT_1, 'Pat One');
    supabase.seedParticipant(PAT_2, 'Pat Two');
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const first = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    expect(first.body.booking.status).toBe('booked');
    const second = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_2 });
    expect(second.body.booking.status).toBe('waitlisted');

    const otherSession = 'aaaaaaaa-1111-4111-8111-111111111199';
    supabase.seedSession({
      id: otherSession,
      class_id: null,
      capacity: null,
    });
    supabase.seedParticipant(PAT_3, 'Pat Three');
    const missingCap = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${otherSession}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_3 });
    expect(missingCap.status).toBe(400);
    expect(missingCap.body).toEqual({ ok: false, error: 'capacity_not_configured' });
  });

  it('rejects missing session, participant, and booking ids', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const badSession = await request(app)
      .get('/api/admin/scheduling-v2/sessions/not-a-uuid/bookings')
      .set('x-admin-key', ADMIN_KEY);
    expect(badSession.body).toEqual({ ok: false, error: 'invalid_session_id' });

    const missingSession = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${MISSING_SESSION}/bookings`)
      .set('x-admin-key', ADMIN_KEY);
    expect(missingSession.status).toBe(404);
    expect(missingSession.body).toEqual({ ok: false, error: 'session_not_found' });

    const missingParticipant = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: MISSING_PARTICIPANT });
    expect(missingParticipant.status).toBe(404);
    expect(missingParticipant.body).toEqual({ ok: false, error: 'participant_not_found' });

    const missingBooking = await request(app)
      .post('/api/admin/scheduling-v2/bookings/ffffffff-6666-4666-8666-666666666666/cancel')
      .set('x-admin-key', ADMIN_KEY);
    expect(missingBooking.status).toBe(404);
    expect(missingBooking.body).toEqual({ ok: false, error: 'booking_not_found' });

    const badBooking = await request(app)
      .post('/api/admin/scheduling-v2/bookings/not-a-uuid/check-in')
      .set('x-admin-key', ADMIN_KEY);
    expect(badBooking.body).toEqual({ ok: false, error: 'invalid_booking_id' });
  });

  it('keeps scheduling RBAC: finance read-only, front_desk may write', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const financeApp = createApp({
      requireAdmin: createRequireAdmin({ lookupStaff: async () => financeStaff }),
      supabase,
    });
    const deskApp = createApp({
      requireAdmin: createRequireAdmin({ lookupStaff: async () => deskStaff }),
      supabase,
    });

    const denied = await request(financeApp)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', 'finance-key')
      .send({ participant_id: PAT_1 });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('forbidden');

    const financeRead = await request(financeApp)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', 'finance-key');
    expect(financeRead.status).toBe(200);

    const desk = await request(deskApp)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', 'desk-key')
      .send({ participant_id: PAT_1 });
    expect(desk.status).toBe(200);
    expect(desk.body.booking.status).toBe('booked');
    expect(desk.body.booking.created_by).toBe(deskStaff.actorLabel);
  });

  it('accepts a cookie session and requires a CSRF origin on writes', async () => {
    process.env.SESSION_SECRET = 'y'.repeat(32);
    process.env.ADMIN_EMAIL = 'singh@example.com';
    process.env.ADMIN_ALLOWED_ORIGINS = 'https://admin.templeunderground.com';
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });
    const token = await encryptAdminSession({ email: 'singh@example.com' });
    const cookie = `${ADMIN_SESSION_COOKIE_NAME}=${token}`;

    const missingOrigin = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('Cookie', cookie)
      .send({ participant_id: PAT_1 });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error).toBe('csrf_failed');

    const created = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('Cookie', cookie)
      .set('Origin', 'https://admin.templeunderground.com')
      .send({ participant_id: PAT_1 });
    expect(created.status).toBe(200);
    expect(created.body.booking.status).toBe('booked');

    const unauthenticated = await request(app).get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error).toBe('unauthorized');
  });

  it('rejects new bookings on a cancelled session', async () => {
    const supabase = createBookingFixture();
    supabase.seedDefaultRoster();
    supabase.seedSession({ cancelled_at: '2026-05-02T00:00:00.000Z' });
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase });

    const res = await request(app)
      .post(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY)
      .send({ participant_id: PAT_1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'booking_closed' });
  });

  it('returns supabase_not_configured when the service-role client is missing', async () => {
    const app = createApp({ requireAdmin: createRequireAdmin(), supabase: null });
    const res = await request(app)
      .get(`/api/admin/scheduling-v2/sessions/${SESSION_ID}/bookings`)
      .set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });
});
