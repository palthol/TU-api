import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCalendarRouter } from './index.js';

const ACTIVE_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const LATER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

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
          if (table === 'session_content') {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (table !== 'classes') {
            return Promise.resolve({ data: null, error: { message: `unknown_table:${table}` } }).then(
              resolve,
              reject,
            );
          }
          let data = rows.map((row) => ({ ...row }));
          for (const f of state.filters) {
            data = data.filter((row) => row[f.col] === f.val);
          }
          data.sort((a, b) => {
            if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
            if (a.start_time !== b.start_time) return String(a.start_time).localeCompare(String(b.start_time));
            return String(a.name).localeCompare(String(b.name));
          });
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

const activeClass = {
  id: ACTIVE_ID,
  name: 'Class 1',
  description: 'Bring a towel',
  instructor: 'Alex',
  day_of_week: 1,
  recurrence: 'weekly',
  start_time: '19:00:00',
  duration_minutes: 90,
  capacity: 16,
  is_active: true,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

describe('GET /api/calendar/classes', () => {
  it('is public and lists only active classes', async () => {
    const supabase = createClassesFixture([
      { ...activeClass, id: LATER_ID, name: 'Later', day_of_week: 3, start_time: '18:00:00' },
      activeClass,
      { ...activeClass, id: 'inactive', name: 'Hidden', is_active: false, description: 'staff only' },
    ]);
    const res = await request(createApp(supabase, { rateLimit: false })).get('/api/calendar/classes');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.classes.map((row) => row.name)).toEqual(['Class 1', 'Later']);
    expect(res.body.classes[0]).toMatchObject({
      id: ACTIVE_ID,
      description: 'Bring a towel',
      instructor: 'Alex',
      duration_minutes: 90,
      capacity: 16,
      is_active: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('staff only');
    expect(res.body).not.toHaveProperty('bookings');
  });

  it('does not require a Bearer token and still accepts the optional header', async () => {
    const app = createApp(createClassesFixture([activeClass]), { rateLimit: false });
    const open = await request(app).get('/api/calendar/classes');
    const withBearer = await request(app).get('/api/calendar/classes').set('authorization', 'Bearer test-token');
    expect(open.status).toBe(200);
    expect(withBearer.status).toBe(200);
    expect(withBearer.body.classes).toHaveLength(1);
  });

  it('returns supabase_not_configured when the service-role client is missing', async () => {
    const res = await request(createApp(null, { rateLimit: false })).get('/api/calendar/classes');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'supabase_not_configured' });
  });

  it('rate-limits public class reads separately from occurrences', async () => {
    const app = createApp(createClassesFixture([activeClass]), { rateLimit: { windowMs: 60_000, max: 1 } });
    const first = await request(app).get('/api/calendar/classes');
    const occurrence = await request(app).get('/api/calendar/occurrences');
    const second = await request(app).get('/api/calendar/classes');
    expect(first.status).toBe(200);
    expect(occurrence.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ ok: false, error: 'rate_limited' });
  });
});
