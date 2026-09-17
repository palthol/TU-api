import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Parse Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]
 * @param {unknown} header
 * @returns {{ timestamp: number, signatures: Buffer[] } | null}
 */
export function parseStripeSignatureHeader(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) return null;
      timestamp = n;
    } else if (key === 'v1') {
      if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) continue;
      signatures.push(Buffer.from(value, 'hex'));
    }
  }
  if (timestamp == null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verify a Stripe webhook signature without the Stripe SDK.
 * @param {{ payload: string, header: unknown, secret: unknown, nowMs?: number }} args
 * @returns {{ ok: true, timestamp: number } | { ok: false, error: string }}
 */
export function verifyStripeSignature({ payload, header, secret, nowMs = Date.now() }) {
  if (typeof secret !== 'string' || !secret.trim()) {
    return { ok: false, error: 'stripe_webhook_not_configured' };
  }
  if (typeof payload !== 'string') {
    return { ok: false, error: 'invalid_signature' };
  }
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return { ok: false, error: 'invalid_signature' };

  const ageSec = Math.abs(nowMs / 1000 - parsed.timestamp);
  if (ageSec > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, error: 'invalid_signature' };
  }

  const expected = createHmac('sha256', secret.trim())
    .update(`${parsed.timestamp}.${payload}`, 'utf8')
    .digest();

  const match = parsed.signatures.some(
    (got) => got.length === expected.length && timingSafeEqual(got, expected),
  );
  if (!match) return { ok: false, error: 'invalid_signature' };
  return { ok: true, timestamp: parsed.timestamp };
}
