import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { AUTH_METHOD } from '../../lib/staffAuth.js';
import { createAdminSchedulingV2Router } from './index.js';

const ADMIN_KEY = 'test-admin-key-sched-v2-stubs';

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

function createApp(requireAdmin) {
  const app = express();
  const router = express.Router();
  router.use(requireAdmin);
  router.use('/scheduling-v2', createAdminSchedulingV2Router());
  app.use('/api/admin', router);
  return app;
}

describe('admin scheduling-v2 stub routes', () => {
  const previousAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
  });

  it('rejects missing x-admin-key', async () => {
    const res = await request(createApp(createRequireAdmin())).get('/api/admin/scheduling-v2/class-types');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('returns 501 not_implemented for authorized callers', async () => {
    const res = await request(createApp(createRequireAdmin()))
      .get('/api/admin/scheduling-v2/class-types')
      .set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ ok: false, error: 'not_implemented' });
  });

  it('keeps the existing scheduling RBAC matrix (finance cannot mutate)', async () => {
    const requireAdmin = createRequireAdmin({ lookupStaff: async () => financeStaff });
    const res = await request(createApp(requireAdmin))
      .post('/api/admin/scheduling-v2/sessions')
      .set('x-admin-key', 'finance-key')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'forbidden' });
  });

  it('allows front_desk to hit scheduling-v2 mutation endpoints (still stubbed)', async () => {
    const requireAdmin = createRequireAdmin({ lookupStaff: async () => deskStaff });
    const res = await request(createApp(requireAdmin))
      .post('/api/admin/scheduling-v2/sessions')
      .set('x-admin-key', 'desk-key')
      .send({});
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('not_implemented');
  });
});

