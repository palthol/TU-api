import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequireAdmin, requireAdmin } from './requireAdmin.js';
import { AUTH_METHOD } from './staffAuth.js';

const ADMIN_KEY = 'test-admin-key-rbac';

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

function createApp(middleware) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(middleware);
  router.get('/auth/me', (req, res) => res.json({ ok: true, role: req.staff.role, actor: req.staff.actorLabel }));
  router.post('/billing/record-payment', (_req, res) => res.json({ ok: true }));
  router.post('/billing/payment-refunds', (_req, res) => res.json({ ok: true }));
  router.post('/scheduling/sessions', (_req, res) => res.json({ ok: true }));
  router.get('/staff', (_req, res) => res.json({ ok: true, rows: [] }));
  app.use('/api/admin', router);
  app.get('/api/waivers/:id/pdf', middleware, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireAdmin', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
  });

  it('rejects missing x-admin-key', async () => {
    const app = createApp(requireAdmin);
    const res = await request(app).get('/api/admin/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rejects a wrong shared key', async () => {
    const app = createApp(requireAdmin);
    const res = await request(app).get('/api/admin/auth/me').set('x-admin-key', 'not-the-key');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('does not treat an empty ADMIN_API_KEY as authorized', async () => {
    process.env.ADMIN_API_KEY = '';
    const app = createApp(requireAdmin);
    const res = await request(app).get('/api/admin/auth/me').set('x-admin-key', '');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('authorizes the shared env key as the legacy owner actor', async () => {
    const writeAudit = vi.fn();
    const app = createApp(createRequireAdmin({ writeAudit }));
    const res = await request(app).get('/api/admin/auth/me').set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, role: 'owner', actor: 'legacy_shared_key' });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('audits mutating shared-key requests as legacy_shared_key', async () => {
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    const app = createApp(createRequireAdmin({ writeAudit }));
    const res = await request(app)
      .post('/api/admin/billing/record-payment')
      .set('x-admin-key', ADMIN_KEY)
      .send({});
    expect(res.status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorLabel: 'legacy_shared_key',
        role: 'owner',
        authMethod: AUTH_METHOD.LEGACY_SHARED_KEY,
        httpMethod: 'POST',
        requestPath: '/billing/record-payment',
      }),
    );
  });

  it('authorizes a personal staff key via lookup', async () => {
    const lookupStaff = vi.fn(async (key) => (key === 'staff-finance-key' ? financeStaff : null));
    const app = createApp(createRequireAdmin({ lookupStaff }));
    const res = await request(app).get('/api/admin/auth/me').set('x-admin-key', 'staff-finance-key');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('finance');
    expect(lookupStaff).toHaveBeenCalledWith('staff-finance-key');
  });

  it('returns forbidden when finance posts scheduling', async () => {
    const lookupStaff = async () => financeStaff;
    const app = createApp(createRequireAdmin({ lookupStaff }));
    const res = await request(app)
      .post('/api/admin/scheduling/sessions')
      .set('x-admin-key', 'staff-finance-key')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'forbidden' });
  });

  it('allows finance refunds and denies front_desk refunds', async () => {
    const lookupStaff = async (key) => (key === 'desk' ? deskStaff : financeStaff);
    const app = createApp(createRequireAdmin({ lookupStaff }));
    const financeRes = await request(app)
      .post('/api/admin/billing/payment-refunds')
      .set('x-admin-key', 'finance')
      .send({});
    const deskRes = await request(app)
      .post('/api/admin/billing/payment-refunds')
      .set('x-admin-key', 'desk')
      .send({});
    expect(financeRes.status).toBe(200);
    expect(deskRes.status).toBe(403);
    expect(deskRes.body.error).toBe('forbidden');
  });

  it('allows front_desk record-payment and scheduling', async () => {
    const app = createApp(createRequireAdmin({ lookupStaff: async () => deskStaff }));
    const payment = await request(app)
      .post('/api/admin/billing/record-payment')
      .set('x-admin-key', 'desk')
      .send({});
    const session = await request(app)
      .post('/api/admin/scheduling/sessions')
      .set('x-admin-key', 'desk')
      .send({});
    expect(payment.status).toBe(200);
    expect(session.status).toBe(200);
  });

  it('denies front_desk listing staff', async () => {
    const app = createApp(createRequireAdmin({ lookupStaff: async () => deskStaff }));
    const res = await request(app).get('/api/admin/staff').set('x-admin-key', 'desk');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'forbidden' });
  });

  it('allows any authenticated staff to request the on-demand PDF gate', async () => {
    const app = createApp(createRequireAdmin({ lookupStaff: async () => deskStaff }));
    const res = await request(app).get('/api/waivers/abc/pdf').set('x-admin-key', 'desk');
    expect(res.status).toBe(200);
  });
});
