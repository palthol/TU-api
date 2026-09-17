/**
 * Public Stripe webhook (API-ADR-006). Not an admin route.
 * Signature verify, then record_payment / record_payment_refund only.
 */

import express from 'express';
import { verifyStripeSignature } from '../../lib/stripeWebhookSignature.js';

const PROVIDER = 'stripe';
const ISSUED_BY = 'stripe_webhook';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_PAYMENT_CHARGE_ERRORS = new Set([
  'charge_not_found',
  'charge_account_mismatch',
  'charge_is_void',
  'allocation_exceeds_net_due',
]);
const RETRYABLE_WEBHOOK_ERRORS = new Set(['payment_not_found']);

function isUniqueViolation(error) {
  return String(error?.code || '') === '23505';
}

function isMissingRecordPaymentFunction(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42883' || code === 'PGRST202') return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('could not find the function') && message.includes('record_payment');
}

function isMissingProcessorTable(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('payment_processor_events') ||
    message.includes('payment_processor_refs') ||
    message.includes('schema cache')
  );
}

function parseRpcDetail(error) {
  const raw = error?.details ?? error?.detail ?? '';
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function recordPaymentErrorPayload(error) {
  const key = String(error?.message || '').trim() || 'record_payment_failed';
  const extra = parseRpcDetail(error);
  const body = { ok: false, error: key };
  if (RECORD_PAYMENT_CHARGE_ERRORS.has(key) && extra.charge_id) {
    body.charge_id = extra.charge_id;
  }
  if (key === 'allocation_exceeds_net_due' && extra.allocatable_cents != null) {
    body.allocatable_cents = extra.allocatable_cents;
  }
  return body;
}

function recordPaymentResult(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const result = row && typeof row === 'object' ? row : {};
  return {
    ok: true,
    payment_id: result.payment_id ?? null,
    receipt_id: result.receipt_id ?? null,
  };
}

function parseUuid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function stripeObjectId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) {
    return value.id.trim();
  }
  return null;
}

function parseAllocations(raw) {
  let parsed;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: 'invalid_allocation_row' };
    }
  } else if (Array.isArray(raw)) {
    parsed = raw;
  } else {
    return { error: 'invalid_allocation_row' };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: 'invalid_allocation_row' };
  const allocations = [];
  for (const row of parsed) {
    const chargeId = parseUuid(row?.charge_id);
    const amount = row?.amount_cents;
    if (!chargeId || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return { error: 'invalid_allocation_row' };
    }
    allocations.push({ charge_id: chargeId, amount_cents: amount });
  }
  return { allocations };
}

export function mapPaymentIntent(pi) {
  if (!pi || typeof pi !== 'object' || typeof pi.id !== 'string' || !pi.id.startsWith('pi_')) {
    return { error: 'invalid_event' };
  }
  const currency = String(pi.currency || '').toLowerCase();
  if (currency !== 'usd') return { error: 'unsupported_currency' };

  const amountReceived = pi.amount_received;
  const amount = pi.amount;
  const amountCents =
    Number.isInteger(amountReceived) && amountReceived > 0
      ? amountReceived
      : Number.isInteger(amount) && amount > 0
        ? amount
        : null;
  if (amountCents == null) return { error: 'unmatched_payment' };

  const metadata = pi.metadata && typeof pi.metadata === 'object' ? pi.metadata : {};
  const accountId = parseUuid(metadata.tu_account_id);
  if (!accountId) return { error: 'unmatched_payment' };

  let allocations;
  if (metadata.tu_allocations != null && String(metadata.tu_allocations).trim() !== '') {
    const parsed = parseAllocations(metadata.tu_allocations);
    if (parsed.error) return { error: parsed.error };
    allocations = parsed.allocations;
  } else {
    const chargeId = parseUuid(metadata.tu_charge_id);
    if (!chargeId) return { error: 'unmatched_payment' };
    allocations = [{ charge_id: chargeId, amount_cents: amountCents }];
  }

  const sum = allocations.reduce((s, row) => s + row.amount_cents, 0);
  if (sum !== amountCents) return { error: 'allocation_sum_must_equal_payment_amount' };

  const paidAt =
    Number.isInteger(pi.created) && pi.created > 0 ? new Date(pi.created * 1000).toISOString() : null;

  const idempotencyKey = `stripe:${pi.id}`.slice(0, 200);
  return {
    accountId,
    amountCents,
    allocations,
    paidAt,
    reference: pi.id,
    idempotencyKey,
    chargeObjectId: stripeObjectId(pi.latest_charge),
  };
}

async function lookupProcessorEvent(supabase, eventId) {
  const { data, error } = await supabase
    .from('payment_processor_events')
    .select('http_status, result, status')
    .eq('provider', PROVIDER)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) return { error };
  return { row: data || null };
}

async function insertProcessorEvent(supabase, row) {
  const { error } = await supabase.from('payment_processor_events').insert(row);
  return { error };
}

async function insertProcessorRef(supabase, row) {
  const { error } = await supabase.from('payment_processor_refs').insert(row);
  if (!error || isUniqueViolation(error)) return { error: null };
  return { error };
}

async function lookupPaymentId(supabase, { paymentIntentId, chargeId }) {
  if (paymentIntentId) {
    const { data, error } = await supabase
      .from('payment_processor_refs')
      .select('payment_id')
      .eq('provider', PROVIDER)
      .eq('object_type', 'payment_intent')
      .eq('object_id', paymentIntentId)
      .maybeSingle();
    if (error) return { error };
    if (data?.payment_id) return { paymentId: data.payment_id };
  }
  if (chargeId) {
    const { data, error } = await supabase
      .from('payment_processor_refs')
      .select('payment_id')
      .eq('provider', PROVIDER)
      .eq('object_type', 'charge')
      .eq('object_id', chargeId)
      .maybeSingle();
    if (error) return { error };
    if (data?.payment_id) return { paymentId: data.payment_id };
  }
  return { paymentId: null };
}

async function handlePaymentIntentSucceeded(event, supabase) {
  const mapped = mapPaymentIntent(event.data?.object);
  if (mapped.error) return { status: 400, body: { ok: false, error: mapped.error } };

  const { data, error } = await supabase.rpc('record_payment', {
    p_account_id: mapped.accountId,
    p_amount_cents: mapped.amountCents,
    p_method: 'card',
    p_issued_by: ISSUED_BY,
    p_allocations: mapped.allocations,
    p_paid_at: mapped.paidAt,
    p_reference: mapped.reference,
    p_notes: `stripe_event:${event.id}`,
    p_issue_receipt: true,
    p_idempotency_key: mapped.idempotencyKey,
  });
  if (error) {
    if (isMissingRecordPaymentFunction(error)) {
      return { status: 503, body: { ok: false, error: 'record_payment_unavailable' } };
    }
    const key = String(error.message || '').trim();
    const status = key === 'idempotency_key_conflict' ? 409 : 400;
    return { status, body: recordPaymentErrorPayload(error) };
  }

  const body = recordPaymentResult(data);
  const refErr = await insertProcessorRef(supabase, {
    provider: PROVIDER,
    object_type: 'payment_intent',
    object_id: event.data.object.id,
    payment_id: body.payment_id,
  });
  if (refErr.error) {
    if (isMissingProcessorTable(refErr.error)) {
      return { status: 503, body: { ok: false, error: 'processor_refs_unavailable' } };
    }
    console.error('payment_processor_refs.insert', refErr.error);
    return { status: 500, body: { ok: false, error: 'processor_refs_failed' } };
  }
  if (mapped.chargeObjectId) {
    const chargeRef = await insertProcessorRef(supabase, {
      provider: PROVIDER,
      object_type: 'charge',
      object_id: mapped.chargeObjectId,
      payment_id: body.payment_id,
    });
    if (chargeRef.error) {
      if (isMissingProcessorTable(chargeRef.error)) {
        return { status: 503, body: { ok: false, error: 'processor_refs_unavailable' } };
      }
      console.error('payment_processor_refs.insert', chargeRef.error);
      return { status: 500, body: { ok: false, error: 'processor_refs_failed' } };
    }
  }
  return { status: 200, body };
}

async function handleRefundCreated(event, supabase) {
  const refund = event.data?.object;
  if (!refund || typeof refund !== 'object' || typeof refund.id !== 'string' || !refund.id.startsWith('re_')) {
    return { status: 400, body: { ok: false, error: 'invalid_event' } };
  }
  const status = String(refund.status || '').toLowerCase();
  if (status && status !== 'succeeded') {
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const amountCents = refund.amount;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { status: 400, body: { ok: false, error: 'invalid_event' } };
  }
  const currency = String(refund.currency || '').toLowerCase();
  if (currency && currency !== 'usd') {
    return { status: 400, body: { ok: false, error: 'unsupported_currency' } };
  }

  const lookedUp = await lookupPaymentId(supabase, {
    paymentIntentId: stripeObjectId(refund.payment_intent),
    chargeId: stripeObjectId(refund.charge),
  });
  if (lookedUp.error) {
    if (isMissingProcessorTable(lookedUp.error)) {
      return { status: 503, body: { ok: false, error: 'processor_refs_unavailable' } };
    }
    console.error('payment_processor_refs.lookup', lookedUp.error);
    return { status: 500, body: { ok: false, error: 'db_error' } };
  }
  if (!lookedUp.paymentId) {
    return { status: 409, body: { ok: false, error: 'payment_not_found' } };
  }

  const { data, error } = await supabase.rpc('record_payment_refund', {
    p_payment_id: lookedUp.paymentId,
    p_amount_cents: amountCents,
    p_reason: 'stripe_refund',
    p_created_by: ISSUED_BY,
    p_idempotency_key: `stripe:${refund.id}`.slice(0, 200),
  });
  if (error) {
    console.error('record_payment_refund', error);
    return { status: 400, body: { ok: false, error: error.message || 'record_payment_refund_failed' } };
  }

  const refundId = data;
  const refErr = await insertProcessorRef(supabase, {
    provider: PROVIDER,
    object_type: 'refund',
    object_id: refund.id,
    payment_id: lookedUp.paymentId,
    payment_refund_id: refundId,
  });
  if (refErr.error) {
    if (isMissingProcessorTable(refErr.error)) {
      return { status: 503, body: { ok: false, error: 'processor_refs_unavailable' } };
    }
    console.error('payment_processor_refs.insert', refErr.error);
    return { status: 500, body: { ok: false, error: 'processor_refs_failed' } };
  }
  return { status: 200, body: { ok: true, refund_id: refundId } };
}

function handleIgnored() {
  return { status: 200, body: { ok: true, ignored: true } };
}

async function persistOutcome(supabase, event, objectId, outcome) {
  if (outcome.status >= 500 || outcome.status === 401) return outcome;
  const errorKey =
    outcome.body && typeof outcome.body === 'object' && outcome.body.ok === false
      ? String(outcome.body.error || '').trim()
      : '';
  if (errorKey && RETRYABLE_WEBHOOK_ERRORS.has(errorKey)) return outcome;
  const status = outcome.body?.ignored ? 'ignored' : 'processed';
  const inserted = await insertProcessorEvent(supabase, {
    provider: PROVIDER,
    event_id: event.id,
    event_type: event.type,
    object_id: objectId,
    status,
    http_status: outcome.status,
    result: outcome.body,
  });
  if (!inserted.error) return outcome;
  if (isUniqueViolation(inserted.error)) {
    const existing = await lookupProcessorEvent(supabase, event.id);
    if (existing.row) {
      return { status: existing.row.http_status, body: existing.row.result };
    }
  }
  if (isMissingProcessorTable(inserted.error)) {
    return { status: 503, body: { ok: false, error: 'processor_refs_unavailable' } };
  }
  console.error('payment_processor_events.insert', inserted.error);
  return { status: 500, body: { ok: false, error: 'processor_event_failed' } };
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   supabase: import('@supabase/supabase-js').SupabaseClient | null,
 *   webhookSecret?: string,
 *   nowMs?: () => number,
 * }} ctx
 */
export function registerStripeWebhookRoute(app, { supabase, webhookSecret, nowMs } = {}) {
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const secret = webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8');
      const payload = raw.toString('utf8');
      const verified = verifyStripeSignature({
        payload,
        header: req.headers['stripe-signature'],
        secret,
        nowMs: (nowMs || Date.now)(),
      });
      if (!verified.ok) {
        const status = verified.error === 'stripe_webhook_not_configured' ? 500 : 401;
        return res.status(status).json({ ok: false, error: verified.error });
      }
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        return res.status(400).json({ ok: false, error: 'invalid_event' });
      }
      if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id.startsWith('evt_')) {
        return res.status(400).json({ ok: false, error: 'invalid_event' });
      }
      if (typeof event.type !== 'string' || !event.type) {
        return res.status(400).json({ ok: false, error: 'invalid_event' });
      }

      const existing = await lookupProcessorEvent(supabase, event.id);
      if (existing.error) {
        if (isMissingProcessorTable(existing.error)) {
          return res.status(503).json({ ok: false, error: 'processor_refs_unavailable' });
        }
        console.error('payment_processor_events.lookup', existing.error);
        return res.status(500).json({ ok: false, error: 'db_error' });
      }
      if (existing.row) {
        return res.status(existing.row.http_status).json(existing.row.result);
      }

      let outcome;
      const objectId = stripeObjectId(event.data?.object);
      if (event.type === 'payment_intent.succeeded') {
        outcome = await handlePaymentIntentSucceeded(event, supabase);
      } else if (event.type === 'refund.created' || event.type === 'refund.updated') {
        outcome = await handleRefundCreated(event, supabase);
      } else {
        outcome = handleIgnored();
      }

      const persisted = await persistOutcome(supabase, event, objectId, outcome);
      return res.status(persisted.status).json(persisted.body);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
