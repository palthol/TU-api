import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerStripeWebhookRoute } from './stripe.js';

const SECRET = 'whsec_test_webhook';
const NOW_MS = 1_700_000_000_000;
const TIMESTAMP = Math.floor(NOW_MS / 1000);
const ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHARGE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PAYMENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const RECEIPT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const REFUND_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function sign(payload, secret = SECRET, timestamp = TIMESTAMP) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function paymentIntentSucceeded({
  eventId = 'evt_pay_1',
  piId = 'pi_test_1',
  amount = 15000,
  metadata = { tu_account_id: ACCOUNT_ID, tu_charge_id: CHARGE_ID },
  latestCharge = 'ch_test_1',
} = {}) {
  return {
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: piId,
        object: 'payment_intent',
        amount,
        amount_received: amount,
        currency: 'usd',
        created: TIMESTAMP,
        latest_charge: latestCharge,
        metadata,
      },
    },
  };
}

function refundCreated({
  eventId = 'evt_re_1',
  refundId = 're_test_1',
  amount = 15000,
  paymentIntent = 'pi_test_1',
  charge = 'ch_test_1',
  status = 'succeeded',
} = {}) {
  return {
    id: eventId,
    type: 'refund.created',
    data: {
      object: {
        id: refundId,
        object: 'refund',
        amount,
        currency: 'usd',
        payment_intent: paymentIntent,
        charge,
        status,
      },
    },
  };
}

function refundUpdated({
  eventId = 'evt_re_up_1',
  refundId = 're_test_1',
  amount = 15000,
  paymentIntent = 'pi_test_1',
  charge = 'ch_test_1',
  status = 'succeeded',
} = {}) {
  return {
    id: eventId,
    type: 'refund.updated',
    data: {
      object: {
        id: refundId,
        object: 'refund',
        amount,
        currency: 'usd',
        payment_intent: paymentIntent,
        charge,
        status,
      },
    },
  };
}

function createIsolatedSupabase({ fail = {} } = {}) {
  const tables = {
    payment_processor_events: [],
    payment_processor_refs: [],
    payments: [],
    payment_allocations: [],
    receipts: [],
    payment_refunds: [],
  };
  const remainingFails = { ...fail };
  const rpcCalls = [];

  function takeFail(table, action) {
    const key = `${table}.${action}`;
    const err = remainingFails[key];
    if (!err) return null;
    delete remainingFails[key];
    return typeof err === 'string' ? { message: err } : err;
  }

  function matches(row, filters) {
    return filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      return true;
    });
  }

  function execute(state, mode) {
    return Promise.resolve().then(() => {
      if (!tables[state.table]) tables[state.table] = [];
      const failErr = takeFail(state.table, state.action);
      if (failErr) return { data: null, error: failErr };

      if (state.action === 'insert') {
        const uniqueCols =
          state.table === 'payment_processor_events'
            ? ['provider', 'event_id']
            : state.table === 'payment_processor_refs'
              ? ['provider', 'object_type', 'object_id']
              : null;
        if (uniqueCols) {
          const dup = tables[state.table].some((row) => uniqueCols.every((col) => row[col] === state.payload[col]));
          if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        const row = { id: state.payload.id || randomUUID(), ...state.payload };
        tables[state.table].push(row);
        if (mode === 'many') return { data: [row], error: null };
        return { data: row, error: null };
      }

      const rows = tables[state.table].filter((row) => matches(row, state.filters));
      if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
      if (mode === 'single') {
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      }
      return { data: rows, error: null };
    });
  }

  function from(table) {
    const state = { table, action: 'select', filters: [], payload: null };
    const api = {
      insert(payload) {
        state.action = 'insert';
        state.payload = payload;
        return api;
      },
      select() {
        state.action = state.action === 'insert' ? 'insert' : 'select';
        return api;
      },
      eq(col, val) {
        state.filters.push(['eq', col, val]);
        return api;
      },
      maybeSingle() {
        return execute(state, 'maybeSingle');
      },
      single() {
        return execute(state, 'single');
      },
      then(resolve, reject) {
        return execute(state, 'many').then(resolve, reject);
      },
    };
    return api;
  }

  function rpc(name, args = {}) {
    rpcCalls.push({ name, args });
    if (name === 'record_payment') {
      const missing = takeFail('record_payment', 'missing');
      if (missing) {
        return Promise.resolve({
          data: null,
          error: missing === true
            ? {
                code: 'PGRST202',
                message: 'Could not find the function public.record_payment in the schema cache',
              }
            : missing,
        });
      }
      const failErr = takeFail('record_payment', 'rpc');
      if (failErr) return Promise.resolve({ data: null, error: failErr });

      const key =
        typeof args.p_idempotency_key === 'string' && args.p_idempotency_key.trim()
          ? args.p_idempotency_key.trim()
          : null;
      if (key) {
        const existing = tables.payments.find((row) => row.idempotency_key === key);
        if (existing) {
          if (
            existing.account_id !== args.p_account_id ||
            existing.amount_cents !== args.p_amount_cents ||
            existing.method !== args.p_method
          ) {
            return Promise.resolve({ data: null, error: { message: 'idempotency_key_conflict' } });
          }
          const receipt = tables.receipts.find((row) => row.payment_id === existing.id);
          return Promise.resolve({
            data: { payment_id: existing.id, receipt_id: receipt?.id ?? null },
            error: null,
          });
        }
      }

      const payment = {
        id: PAYMENT_ID,
        account_id: args.p_account_id,
        amount_cents: args.p_amount_cents,
        method: args.p_method,
        idempotency_key: key,
      };
      tables.payments.push(payment);
      for (const row of args.p_allocations || []) {
        tables.payment_allocations.push({
          id: randomUUID(),
          payment_id: payment.id,
          charge_id: row.charge_id,
          amount_cents: row.amount_cents,
        });
      }
      const receipt = { id: RECEIPT_ID, payment_id: payment.id, receipt_kind: 'money_in' };
      tables.receipts.push(receipt);
      return Promise.resolve({ data: { payment_id: payment.id, receipt_id: receipt.id }, error: null });
    }

    if (name === 'record_payment_refund') {
      const failErr = takeFail('record_payment_refund', 'rpc');
      if (failErr) return Promise.resolve({ data: null, error: failErr });
      const key =
        typeof args.p_idempotency_key === 'string' && args.p_idempotency_key.trim()
          ? args.p_idempotency_key.trim()
          : null;
      if (key) {
        const existing = tables.payment_refunds.find((row) => row.idempotency_key === key);
        if (existing) {
          if (existing.payment_id !== args.p_payment_id || existing.amount_cents !== args.p_amount_cents) {
            return Promise.resolve({ data: null, error: { message: 'idempotency_key_conflict' } });
          }
          return Promise.resolve({ data: existing.id, error: null });
        }
      }
      const row = {
        id: REFUND_ID,
        payment_id: args.p_payment_id,
        amount_cents: args.p_amount_cents,
        idempotency_key: key,
      };
      tables.payment_refunds.push(row);
      return Promise.resolve({ data: row.id, error: null });
    }

    return Promise.resolve({ data: null, error: { message: `unexpected_rpc:${name}` } });
  }

  return { supabase: { from, rpc }, tables, rpcCalls };
}

function createWebhookApp(supabase) {
  const app = express();
  registerStripeWebhookRoute(app, {
    supabase,
    webhookSecret: SECRET,
    nowMs: () => NOW_MS,
  });
  app.use(express.json());
  return app;
}

function postWebhook(app, event) {
  const payload = JSON.stringify(event);
  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', sign(payload))
    .send(payload);
}

describe('POST /api/webhooks/stripe', () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  it('rejects a missing signature', async () => {
    const { supabase } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(paymentIntentSucceeded()));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'invalid_signature' });
  });

  it('rejects a wrong signature and does not treat x-admin-key as auth', async () => {
    const { supabase, rpcCalls } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    const payload = JSON.stringify(paymentIntentSucceeded());
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=deadbeef')
      .set('x-admin-key', 'not-a-stripe-secret')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'invalid_signature' });
    expect(rpcCalls).toEqual([]);
  });

  it('returns stripe_webhook_not_configured when the secret is unset', async () => {
    const { supabase } = createIsolatedSupabase();
    const app = express();
    registerStripeWebhookRoute(app, { supabase, webhookSecret: '', nowMs: () => NOW_MS });
    const payload = JSON.stringify(paymentIntentSucceeded());
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(payload))
      .send(payload);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'stripe_webhook_not_configured' });
  });

  it('records a succeeded PaymentIntent through record_payment', async () => {
    const { supabase, tables, rpcCalls } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    const event = paymentIntentSucceeded();
    const res = await postWebhook(app, event);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, payment_id: PAYMENT_ID, receipt_id: RECEIPT_ID });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: 'record_payment',
      args: {
        p_account_id: ACCOUNT_ID,
        p_amount_cents: 15000,
        p_method: 'card',
        p_issued_by: 'stripe_webhook',
        p_allocations: [{ charge_id: CHARGE_ID, amount_cents: 15000 }],
        p_reference: 'pi_test_1',
        p_issue_receipt: true,
        p_idempotency_key: 'stripe:pi_test_1',
      },
    });
    expect(tables.payments).toHaveLength(1);
    expect(tables.payment_allocations).toHaveLength(1);
    expect(tables.payment_processor_refs.map((row) => row.object_type).sort()).toEqual([
      'charge',
      'payment_intent',
    ]);
  });

  it('replays a duplicate event without a second payment or allocation', async () => {
    const { supabase, tables, rpcCalls } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    const event = paymentIntentSucceeded();
    const first = await postWebhook(app, event);
    const second = await postWebhook(app, event);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(rpcCalls).toHaveLength(1);
    expect(tables.payments).toHaveLength(1);
    expect(tables.payment_allocations).toHaveLength(1);
  });

  it('fails closed when PaymentIntent metadata is missing account or charge ids', async () => {
    const { supabase, rpcCalls, tables } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    const res = await postWebhook(
      app,
      paymentIntentSucceeded({ metadata: { customer: 'cus_1' } }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'unmatched_payment' });
    expect(rpcCalls).toEqual([]);
    expect(tables.payments).toEqual([]);
  });

  it('does not use sequential inserts when record_payment is missing', async () => {
    const { supabase, tables } = createIsolatedSupabase({
      fail: { 'record_payment.missing': true },
    });
    const app = createWebhookApp(supabase);
    const res = await postWebhook(app, paymentIntentSucceeded());
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'record_payment_unavailable' });
    expect(tables.payments).toEqual([]);
    expect(tables.payment_allocations).toEqual([]);
    expect(tables.receipts).toEqual([]);
  });

  it('ignores charge.succeeded so a paired charge event cannot double-allocate', async () => {
    const { supabase, rpcCalls, tables } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    await postWebhook(app, paymentIntentSucceeded());
    const chargeEvent = {
      id: 'evt_ch_1',
      type: 'charge.succeeded',
      data: { object: { id: 'ch_test_1', amount: 15000, currency: 'usd' } },
    };
    const res = await postWebhook(app, chargeEvent);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ignored: true });
    expect(rpcCalls).toHaveLength(1);
    expect(tables.payments).toHaveLength(1);
  });

  it('maps refund.created to record_payment_refund', async () => {
    const { supabase, rpcCalls } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    await postWebhook(app, paymentIntentSucceeded());
    const res = await postWebhook(app, refundCreated());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, refund_id: REFUND_ID });
    expect(rpcCalls[1]).toMatchObject({
      name: 'record_payment_refund',
      args: {
        p_payment_id: PAYMENT_ID,
        p_amount_cents: 15000,
        p_reason: 'stripe_refund',
        p_created_by: 'stripe_webhook',
        p_idempotency_key: 'stripe:re_test_1',
      },
    });
  });

  it('fails closed when a refund arrives before the PaymentIntent is booked', async () => {
    const { supabase, rpcCalls } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    const res = await postWebhook(app, refundCreated());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'payment_not_found' });
    expect(rpcCalls).toEqual([]);
  });

  it('retries refund.created after the payment is booked without caching payment_not_found', async () => {
    const { supabase, rpcCalls, tables } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);

    const refundEvent = refundCreated({ eventId: 'evt_re_oop_1', refundId: 're_oop_1' });
    const first = await postWebhook(app, refundEvent);
    expect(first.status).toBe(409);
    expect(first.body).toEqual({ ok: false, error: 'payment_not_found' });

    const payment = await postWebhook(app, paymentIntentSucceeded({ eventId: 'evt_pay_oop_1', piId: 'pi_oop_1' }));
    expect(payment.status).toBe(200);

    const second = await postWebhook(app, refundEvent);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, refund_id: REFUND_ID });

    expect(rpcCalls.filter((c) => c.name === 'record_payment_refund')).toHaveLength(1);
    expect(tables.payment_refunds).toHaveLength(1);
  });

  it('records refund.updated when a refund transitions from pending to succeeded', async () => {
    const { supabase, rpcCalls, tables } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    await postWebhook(app, paymentIntentSucceeded({ eventId: 'evt_pay_ru_1', piId: 'pi_ru_1' }));

    const pending = await postWebhook(
      app,
      refundCreated({ eventId: 'evt_re_pending_1', refundId: 're_pending_1', status: 'pending' }),
    );
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ ok: true, ignored: true });

    const succeeded = await postWebhook(
      app,
      refundUpdated({ eventId: 'evt_re_succeeded_1', refundId: 're_pending_1', status: 'succeeded' }),
    );
    expect(succeeded.status).toBe(200);
    expect(succeeded.body).toEqual({ ok: true, refund_id: REFUND_ID });

    expect(rpcCalls.filter((c) => c.name === 'record_payment_refund')).toHaveLength(1);
    expect(tables.payment_refunds).toHaveLength(1);
  });

  it('does not double-record a refund when both refund.created and refund.updated succeed', async () => {
    const { supabase, rpcCalls, tables } = createIsolatedSupabase();
    const app = createWebhookApp(supabase);
    await postWebhook(app, paymentIntentSucceeded({ eventId: 'evt_pay_rdup_1', piId: 'pi_rdup_1' }));

    const created = await postWebhook(
      app,
      refundCreated({ eventId: 'evt_re_created_s_1', refundId: 're_dupe_1', status: 'succeeded' }),
    );
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ ok: true, refund_id: REFUND_ID });

    const updated = await postWebhook(
      app,
      refundUpdated({ eventId: 'evt_re_updated_s_1', refundId: 're_dupe_1', status: 'succeeded' }),
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ ok: true, refund_id: REFUND_ID });

    expect(rpcCalls.filter((c) => c.name === 'record_payment_refund')).toHaveLength(2);
    expect(tables.payment_refunds).toHaveLength(1);
  });
});
