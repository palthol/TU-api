import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMemberRouter } from './index.js';

function createApp() {
  const app = express();
  app.use('/api/member', createMemberRouter());
  return app;
}

describe('member stub routes', () => {
  it('returns 501 not_implemented without requiring Bearer yet', async () => {
    const res = await request(createApp()).get('/api/member/me');
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ ok: false, error: 'not_implemented' });
  });

  it('accepts a Bearer header shape (still stubbed)', async () => {
    const res = await request(createApp())
      .get('/api/member/bookings')
      .set('authorization', 'Bearer test-token');
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('not_implemented');
  });
});

