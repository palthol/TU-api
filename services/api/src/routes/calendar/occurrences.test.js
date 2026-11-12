import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarRouter } from './index.js';

const CLASS_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

function createClassesFixture(rows) {
  return {
    from(table) {
      const state = { filters: [] };
      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          state.filters.push({ col, val });
          return api;
        },
        order() {
          return api;
        },
        then(resolve, reject) {
          if (table !== 'classes') {
            return Promise.resolve({ data: null, error: { message: `unknown_table:${table}` } }).then(
              resolve,
              reject,
            );
          }
          let data = [...rows];
          for (const f of state.filters) {
            data = data.filter((row) => row[f.col] === f.val);
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function createApp(supabase, { rateLimit } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/calendar', createCalendarRouter({ supabase, rateLimit }));
  return app;
}

const mondayClass = {
  id: CLASS_ID,
  name: 'Class 1',
  instructor: 'Alex',
  day_of_week: 1,
  recurrence: 'weekly',
  start_time: '19:00:00',
  duration_minutes: 60,
  capacity: 12,
  is_active: true,
};

describe('GET /api/calendar/occurrences', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is public and lists upcoming 14-day occurrences for active classes', async () => {
    const supabase = createClassesFixture([
      mondayClass,
      { ...mondayClass, id: 'inactive', is_active: false, name: 'Hidden' },
    ]);
    const res = await request(createApp(supabase, { rateLimit: false })).get('/api/calendar/occurrences');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.timezone).toBe('America/New_York');
    expect(res.body.window).toEqual({
      start_date: '2026-11-06',
      end_date: '2026-11-19',
      days: 14,
    });
    expect(res.body.occurrences).toHaveLength(2);
    expect(res.body.occurrences[0]).toMatchObject({
      class_id: CLASS_ID,
      name: 'Class 1',
      instructor: 'Alex',
      gym_date: '2026-11-09',
      starts_at: '2026-11-10T00:00:00.000Z',
      capacity: 12,
    });
    expect(res.body.occurrences.every((row) => row.name !== 'Hidden')).toBe(true);
    expect(res.body).not.toHaveProperty('bookings');
  });

  it('does not require a Bearer token and still accepts the optional header', async () => {
    const app = createApp(createClassesFixture([mondayClass]), { rateLimit: false });
    const withBearer = await request(app)
      .get('/api/calendar/occurrences')
      .set('authorization', 'Bearer test-token');
    expect(withBearer.status).toBe(200);
    expect(withBearer.body.ok).toBe(true);
  });

  it('returns supabase_not_configured when the service-role client is missing', async () => {
    const res = await request(createApp(null, { rateLimit: false })).get('/api/calendar/occurrences');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });

  it('rate-limits public occurrence reads per IP', async () => {
    vi.useRealTimers();
    const app = createApp(createClassesFixture([mondayClass]), { rateLimit: { windowMs: 60_000, max: 1 } });
    const first = await request(app).get('/api/calendar/occurrences');
    const second = await request(app).get('/api/calendar/occurrences');
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ ok: false, error: 'rate_limited' });
  });
});
