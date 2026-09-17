import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from './stripeWebhookSignature.js';

const SECRET = 'whsec_test_signature';
const NOW_MS = 1_700_000_000_000;
const TIMESTAMP = Math.floor(NOW_MS / 1000);

function sign(payload, secret = SECRET, timestamp = TIMESTAMP) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a matching v1 signature within the timestamp window', () => {
    const payload = '{"id":"evt_1"}';
    const result = verifyStripeSignature({
      payload,
      header: sign(payload),
      secret: SECRET,
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: true, timestamp: TIMESTAMP });
  });

  it('rejects a missing secret', () => {
    const payload = '{"id":"evt_1"}';
    expect(
      verifyStripeSignature({ payload, header: sign(payload), secret: '', nowMs: NOW_MS }),
    ).toEqual({ ok: false, error: 'stripe_webhook_not_configured' });
  });

  it('rejects a tampered payload', () => {
    const header = sign('{"id":"evt_1"}');
    expect(
      verifyStripeSignature({
        payload: '{"id":"evt_2"}',
        header,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, error: 'invalid_signature' });
  });

  it('rejects a stale timestamp', () => {
    const payload = '{"id":"evt_1"}';
    const oldTs = TIMESTAMP - 301;
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, SECRET, oldTs),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, error: 'invalid_signature' });
  });
});
