import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
export const DEFAULT_LEAD_RATE_LIMIT_MAX = 10;
export const DEFAULT_WAIVER_SUBMIT_RATE_LIMIT_MAX = 10;
export const DEFAULT_LEAD_JSON_LIMIT = '16kb';
export const DEFAULT_WAIVER_SUBMIT_JSON_LIMIT = '512kb';
export const HONEYPOT_FIELD = 'website';
export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_UNSET_WARNING =
  'turnstile.secret_unset: public POST allowed without Turnstile verification';
export const TURNSTILE_VERIFY_TIMEOUT_MS = 5000;

let turnstileUnsetWarned = false;

export function resetTurnstileUnsetWarning() {
  turnstileUnsetWarned = false;
}

export function parsePositiveInt(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function parseJsonLimit(value, fallback) {
  if (value == null) return fallback;
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

/**
 * Render terminates TLS at one reverse proxy. `true` is too permissive and
 * express-rate-limit refuses it (`ERR_ERL_PERMISSIVE_TRUST_PROXY`).
 */
export function parseTrustProxy(value) {
  if (value == null || String(value).trim() === '') return 1;
  const trimmed = String(value).trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'true') return 1;
  if (lower === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function readPublicPostLimitsFromEnv(env = process.env) {
  return {
    leadJsonLimit: parseJsonLimit(env.LEAD_JSON_LIMIT, DEFAULT_LEAD_JSON_LIMIT),
    waiverJsonLimit: parseJsonLimit(env.WAIVER_SUBMIT_JSON_LIMIT, DEFAULT_WAIVER_SUBMIT_JSON_LIMIT),
    leadWindowMs: parsePositiveInt(env.LEAD_RATE_LIMIT_WINDOW_MS, FIFTEEN_MINUTES_MS),
    waiverWindowMs: parsePositiveInt(env.WAIVER_SUBMIT_RATE_LIMIT_WINDOW_MS, FIFTEEN_MINUTES_MS),
    leadMax: parsePositiveInt(env.LEAD_RATE_LIMIT_MAX, DEFAULT_LEAD_RATE_LIMIT_MAX),
    waiverMax: parsePositiveInt(env.WAIVER_SUBMIT_RATE_LIMIT_MAX, DEFAULT_WAIVER_SUBMIT_RATE_LIMIT_MAX),
  };
}

export function trustCfConnectingIp(env = process.env) {
  const raw = String(env.TRUST_CF_CONNECTING_IP || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Rate-limit key IP. Defaults to Express `req.ip` (honors `TRUST_PROXY`).
 * `cf-connecting-ip` is only used when TRUST_CF_CONNECTING_IP is set, which
 * must mean the origin is locked to Cloudflare so clients cannot spoof it.
 */
export function clientIp(req, env = process.env) {
  if (trustCfConnectingIp(env)) {
    const cf = req.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  if (typeof req.ip === 'string' && req.ip.trim()) return req.ip.trim();
  return '';
}

export function isHoneypotFilled(body) {
  if (!body || typeof body !== 'object') return false;
  const value = body[HONEYPOT_FIELD];
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function honeypotGuard(req, res, next) {
  if (isHoneypotFilled(req.body)) {
    return res.status(200).json({ ok: true });
  }
  return next();
}

export function extractTurnstileToken(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fromBody = body.turnstileToken ?? body['cf-turnstile-response'];
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  const header = req.headers?.['cf-turnstile-response'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

export function jsonPayloadTooLargeHandler(err, _req, res, next) {
  if (err?.type === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }
  return next(err);
}

/**
 * Express 5 forwards rejected promises from async handlers here. Keep the
 * JSON `{ ok:false }` envelope instead of the default HTML error page.
 */
export function jsonUnhandledErrorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);
  console.error(err);
  return res.status(500).json({ ok: false, error: 'server_error' });
}

export function createTurnstileMiddleware({
  getSecret = () => process.env.TURNSTILE_SECRET_KEY,
  fetchImpl = globalThis.fetch.bind(globalThis),
} = {}) {
  return async function verifyTurnstile(req, res, next) {
    const secret = String(getSecret() || '').trim();
    if (!secret) {
      if (!turnstileUnsetWarned) {
        turnstileUnsetWarned = true;
        console.warn(TURNSTILE_UNSET_WARNING);
      }
      return next();
    }

    const token = extractTurnstileToken(req);
    if (!token) {
      return res.status(400).json({ ok: false, error: 'turnstile_failed' });
    }

    try {
      const params = new URLSearchParams();
      params.set('secret', secret);
      params.set('response', token);
      const ip = clientIp(req);
      if (ip) params.set('remoteip', ip);

      const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS),
      });
      const data = await response.json();
      if (!data?.success) {
        return res.status(400).json({ ok: false, error: 'turnstile_failed' });
      }
      return next();
    } catch (error) {
      console.error('turnstile.siteverify_failed', error instanceof Error ? error.message : 'error');
      return res.status(400).json({ ok: false, error: 'turnstile_failed' });
    }
  };
}

export function createPublicPostRateLimiter({ name, windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator(req) {
      return ipKeyGenerator(clientIp(req) || '0.0.0.0');
    },
    handler(_req, res) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
    },
    // Distinct prefix so lead and waiver stores never share counters.
    identifier: name,
  });
}

export function createPublicPostMiddleware({
  name,
  jsonLimit,
  windowMs,
  max,
  getSecret,
  fetchImpl,
} = {}) {
  return [
    createPublicPostRateLimiter({ name, windowMs, max }),
    express.json({ limit: jsonLimit }),
    honeypotGuard,
    createTurnstileMiddleware({ getSecret, fetchImpl }),
  ];
}
