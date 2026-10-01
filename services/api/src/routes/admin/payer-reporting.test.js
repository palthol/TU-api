import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerAdminReportingRoutes } from './reporting.js';
import { registerAdminNotificationRoutes } from './notifications.js';
import { createRequireAdmin } from '../../lib/requireAdmin.js';
import { postDiscordWebhook } from '../../services/discord.js';
vi.mock('../../services/discord.js', () => ({ postDiscordWebhook: vi.fn(async () => {}) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function setup(rows = [], error = null) {
  const q = { select: vi.fn(() => q), gte: vi.fn(() => q), lte: vi.fn(() => q),
    order: vi.fn(() => q), range: vi.fn(() => q),
    then: (resolve, reject) => Promise.resolve({ data: rows, error, count: 0 }).then(resolve, reject) };
  const db = { from: vi.fn(() => q) };
  const app = express(); app.use(express.json());
  const router = express.Router();
  router.use(createRequireAdmin({ lookupStaff: async key => key === 'local-key' ? { role: 'owner' } : null }));
  registerAdminReportingRoutes(router, { supabase: db });
  registerAdminNotificationRoutes(router, { supabase: db });
  app.use('/api/admin', router);
  return { app, db, q };
}
describe('payer reports and notification integration', () => {
  it.each(['payer-charge-board', 'payer-payment-reminders'])('exposes additive %s with date filters and cents intact', async slug => {
    const row = { charge_id: 'charge-1', outstanding_cents: 10234, covered_participants: [{ participant_id: 'p1' }] };
    const { app, db, q } = setup([row]);
    const res = await request(app).get(`/api/admin/reporting/views/${slug}`).set('x-admin-key', 'local-key')
      .query({ start: '2030-01-01', end: '2030-02-01', sort: 'outstanding_cents', order: 'asc', limit: 10 });
    expect(res.status).toBe(200); expect(res.body.rows).toEqual([row]);
    expect(db.from).toHaveBeenCalledWith(slug === 'payer-charge-board' ? 'view_payer_charge_board' : 'view_payer_payment_reminders');
    expect(q.gte).toHaveBeenCalledWith('due_at', '2030-01-01');
    expect(q.lte).toHaveBeenCalledWith('due_at', '2030-02-01');
    expect(q.order).toHaveBeenCalledWith('outstanding_cents', { ascending: true });
    expect(q.range).toHaveBeenCalledWith(0, 9);
  });
  it('preserves legacy member report mapping', async () => {
    const { app, db } = setup();
    expect((await request(app).get('/api/admin/reporting/views/payment-board').set('x-admin-key', 'local-key')).status).toBe(200);
    expect(db.from).toHaveBeenCalledWith('view_member_payment_board');
  });
  it('requires authentication for new reports', async () => {
    const { app, db } = setup();
    expect((await request(app).get('/api/admin/reporting/views/payer-charge-board')).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(['payment-reminders', 'daily-digest'])('%s uses charge debt and formats cents once (webhook mocked)', async endpoint => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://example.invalid/test-only');
    const rows = [
      { charge_id: 'charge-a', payer_name: 'Synthetic payer', obligation_label: 'Training', outstanding_cents: 10234, due_at: '2030-01-01', days_late: 2, reminder_bucket: 'overdue' },
      { charge_id: 'charge-b', payer_name: 'Synthetic payer', obligation_label: 'Coaching', outstanding_cents: 5000, due_at: '2030-01-03', days_late: 0, reminder_bucket: 'due_soon' },
    ];
    const { app, db } = setup(rows);
    const res = await request(app).post(`/api/admin/notifications/discord/${endpoint}`).set('x-admin-key', 'local-key');
    expect(res.status).toBe(200);
    expect(db.from).toHaveBeenCalledWith('view_payer_payment_reminders');
    expect(db.from).not.toHaveBeenCalledWith('view_member_payment_reminders');
    expect(postDiscordWebhook).toHaveBeenCalledTimes(1);
    const content = postDiscordWebhook.mock.calls[0][1];
    expect(content).toContain('Training [charge-a] — $102.34');
    expect(content).toContain('Coaching [charge-b] — $50.00');
    expect(content.match(/\[charge-a\]/g)).toHaveLength(1);
    if (endpoint === 'payment-reminders') expect(res.body.rowCount).toBe(2);
    else expect(res.body.summary).toMatchObject({ reminderTotal: 2, overdueCount: 1, dueSoonCount: 1 });
  });
  it('does not send incomplete reminders if report query fails', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://example.invalid/test-only');
    const { app } = setup([], { message: 'view unavailable' });
    expect((await request(app).post('/api/admin/notifications/discord/payment-reminders').set('x-admin-key', 'local-key')).status).toBe(400);
    expect(postDiscordWebhook).not.toHaveBeenCalled();
  });
});
