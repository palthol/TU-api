import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCalendarRouter } from './index.js';

function createApp() {
  const app = express();
  app.use('/api/calendar', createCalendarRouter());
  return app;
}

describe('calendar stub routes', () => {
  it('returns 501 not_implemented for read endpoints', async () => {
    const res = await request(createApp()).get('/api/calendar/sessions');
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ ok: false, error: 'not_implemented' });
  });

  it('accepts optional Bearer auth shape (still stubbed)', async () => {
    const res = await request(createApp())
      .get('/api/calendar/class-types')
      .set('authorization', 'Bearer test-token');
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('not_implemented');
  });
});

