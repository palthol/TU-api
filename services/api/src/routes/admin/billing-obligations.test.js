import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { registerAdminBillingRoutes } from './billing.js';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
const id = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const body = { id, account_id: account, label: 'Training agreement', amount_cents: 12345, anchor_date: '2031-01-31' };
function setup(role = 'finance', response = { data: { ...body, status: 'draft' }, error: null }) {
  const db = { rpc: vi.fn(async () => response) };
  const app = express(); app.use(express.json());
  const router = express.Router();
  router.use(createRequireAdmin({ lookupStaff: async key => key === 'test-personal-key' ? { role } : null }));
  registerAdminBillingRoutes(router, { supabase: db });
  app.use('/api/admin', router);
  return { db, app };
}
const path = '/api/admin/billing/obligations';
describe('payer obligation routes', () => {
  it('creates a draft with explicit payer and no plan-derived amount', async () => {
    const { db, app } = setup();
    const res = await request(app).post(path).set('x-admin-key', 'test-personal-key').send({ ...body, participant_ids: [id] });
    expect(res.status).toBe(200); expect(res.body.obligation.status).toBe('draft');
    expect(db.rpc).toHaveBeenCalledWith('create_billing_obligation', {
      p_id: id, p_account_id: account, p_label: body.label, p_amount_cents: 12345,
      p_anchor_date: '2031-01-31', p_participant_ids: [id], p_notes: null, p_replaces_obligation_id: null,
    });
  });
  it.each([{ amount_cents: 1.5 }, { amount_cents: '12345' }, { amount_cents: 0 },
    { amount_cents: -1 }, { amount_cents: 2147483648 }, { anchor_date: '2031-02-29' },
    { anchor_date: '2031-04-31' }, { account_id: 'bad' }, { id: 'bad' }, { label: ' ' },
    { participant_ids: [id, id] }, { participant_ids: ['bad'] }, { participant_ids: null },
    { status: 'active' }, { currency: 'EUR' }, { replaces_obligation_id: 'bad' }, { notes: 5 }])(
    'rejects malformed/unsupported configuration %j before writes', async patch => {
      const { db, app } = setup();
      expect((await request(app).post(path).set('x-admin-key', 'test-personal-key').send({ ...body, ...patch })).status).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    });
  it.each(['owner', 'finance'])('allows %s to activate with an explicit boundary', async role => {
    const { db, app } = setup(role);
    const res = await request(app).post(`${path}/${id}/transition`).set('x-admin-key', 'test-personal-key')
      .send({ action: 'activate', billing_starts_on: '2031-02-28' });
    expect(res.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('transition_billing_obligation', {
      p_id: id, p_action: 'activate', p_billing_starts_on: '2031-02-28',
    });
  });
  it.each(['pause', 'end'])('supports %s without altering money terms', async action => {
    const { db, app } = setup();
    expect((await request(app).post(`${path}/${id}/transition`).set('x-admin-key', 'test-personal-key').send({ action })).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('transition_billing_obligation', { p_id: id, p_action: action, p_billing_starts_on: null });
  });
  it.each([{ action: 'activate' }, { action: 'activate', billing_starts_on: '2031-02-30' },
    { action: 'resume' }, { action: 'pause', amount_cents: 1 }, { action: 'end', billing_starts_on: '2031-01-31' }])(
    'rejects invalid transitions %j', async payload => {
      const { db, app } = setup();
      expect((await request(app).post(`${path}/${id}/transition`).set('x-admin-key', 'test-personal-key').send(payload)).status).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    });
  it('blocks front desk, unauthenticated, and cron-only mutations', async () => {
    const { db, app } = setup('front_desk');
    for (const endpoint of [path, `${path}/${id}/transition`]) {
      expect((await request(app).post(endpoint).set('x-admin-key', 'test-personal-key').send(body)).status).toBe(403);
      expect((await request(app).post(endpoint).send(body)).status).toBe(401);
      expect((await request(app).post(endpoint).set('x-cron-secret', 'test-secret').send(body)).status).toBe(401);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('returns conflict for a repeated create ID without retrying with a new ID', async () => {
    const { db, app } = setup('finance', { data: null, error: { code: '23505', message: 'duplicate key' } });
    const res = await request(app).post(path).set('x-admin-key', 'test-personal-key').send(body);
    expect(res.status).toBe(409); expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('surfaces atomic replacement failures', async () => {
    const { app } = setup('finance', { data: null, error: { message: 'replacement_overlaps_existing_charge' } });
    const res = await request(app).post(`${path}/${id}/transition`).set('x-admin-key', 'test-personal-key')
      .send({ action: 'activate', billing_starts_on: '2031-01-31' });
    expect(res.status).toBe(400); expect(res.body.error).toBe('replacement_overlaps_existing_charge');
  });
  it('lists only the requested account with participant links', async () => {
    const { app, db } = setup();
    const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(async () => ({ data: [body], error: null })) };
    db.from = vi.fn(() => q);
    const res = await request(app).get(path).query({ account_id: account }).set('x-admin-key', 'test-personal-key');
    expect(res.body).toEqual({ ok: true, obligations: [body] });
    expect(q.eq).toHaveBeenCalledWith('account_id', account);
  });
});

describe('obligation entitlement-only route', () => {
  const endpoint = `${path}/${id}/entitlements`;
  const enrollment = { id, participant_id: account, plan_definition_id: id };
  it.each(['owner', 'finance'])('lets %s enroll with an explicit agreement and no charge flag', async role => {
    const { app, db } = setup(role, { data: { subscription_id: id, initial_charge_id: null }, error: null });
    const res = await request(app).post(endpoint).set('x-admin-key', 'test-personal-key').send(enrollment);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, subscription_id: id, initial_charge_id: null });
    expect(db.rpc).toHaveBeenCalledWith('enroll_obligation_entitlement', {
      p_id: id, p_obligation_id: id, p_participant_id: account, p_plan_definition_id: id, p_replaces_subscription_id: null,
    });
  });
  it('passes explicit predecessor for no-charge plan change', async () => {
    const { app, db } = setup();
    const res = await request(app).post(endpoint).set('x-admin-key', 'test-personal-key')
      .send({ ...enrollment, replaces_subscription_id: account });
    expect(res.status).toBe(200);
    expect(db.rpc.mock.calls[0][1].p_replaces_subscription_id).toBe(account);
  });
  it.each([{ id: 'bad' }, { participant_id: null }, { plan_definition_id: 'bad' },
    { replaces_subscription_id: 'bad' }, { amount_cents: 100 }, { create_initial_charge: true }, { starts_at: '2031-01-01' }])(
    'rejects malformed and charge/retroactive controls %j', async patch => {
      const { app, db } = setup();
      expect((await request(app).post(endpoint).set('x-admin-key', 'test-personal-key').send({ ...enrollment, ...patch })).status).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    });
  it('blocks front desk, anonymous and cron-only callers', async () => {
    const { app, db } = setup('front_desk');
    expect((await request(app).post(endpoint).set('x-admin-key', 'test-personal-key').send(enrollment)).status).toBe(403);
    expect((await request(app).post(endpoint).send(enrollment)).status).toBe(401);
    expect((await request(app).post(endpoint).set('x-cron-secret', 'test-secret').send(enrollment)).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('returns 409 on retry without issuing a new subscription ID', async () => {
    const { app, db } = setup('finance', { data: null, error: { code: '23505', message: 'subscription_id_already_exists' } });
    expect((await request(app).post(endpoint).set('x-admin-key', 'test-personal-key').send(enrollment)).status).toBe(409);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('surfaces transactional rejection without fallback writes', async () => {
    const { app } = setup('finance', { data: null, error: { message: 'participant_not_covered_by_obligation' } });
    const res = await request(app).post(endpoint).set('x-admin-key', 'test-personal-key').send(enrollment);
    expect(res.status).toBe(400); expect(res.body.error).toBe('participant_not_covered_by_obligation');
  });
});
