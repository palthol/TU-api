import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { registerWaiverSubmitRoute } from '../services/accounts/submitWaiver.js';
import {
  DEFAULT_LEAD_JSON_LIMIT,
  DEFAULT_LEAD_RATE_LIMIT_MAX,
  DEFAULT_WAIVER_SUBMIT_JSON_LIMIT,
  DEFAULT_WAIVER_SUBMIT_RATE_LIMIT_MAX,
  FIFTEEN_MINUTES_MS,
  HONEYPOT_FIELD,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_UNSET_WARNING,
  createPublicPostMiddleware,
  jsonPayloadTooLargeHandler,
  parseJsonLimit,
  parsePositiveInt,
  parseTrustProxy,
  readPublicPostLimitsFromEnv,
  resetTurnstileUnsetWarning,
} from './publicPostGuard.js';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z2wAAAABJRU5ErkJggg==';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  resetTurnstileUnsetWarning();
  vi.restoreAllMocks();
});

function createTestApp({
  name = 'test',
  jsonLimit = '16kb',
  windowMs = 60_000,
  max = 50,
  getSecret = () => '',
  fetchImpl,
  handler = (_req, res) => res.json({ ok: true, handled: true }),
} = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.post(
    '/submit',
    ...createPublicPostMiddleware({ name, jsonLimit, windowMs, max, getSecret, fetchImpl }),
    handler,
  );
  app.use(jsonPayloadTooLargeHandler);
  return app;
}

describe('parseTrustProxy / env defaults', () => {
  it('defaults to 1 hop for Render and never enables boolean true', () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy('')).toBe(1);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('true')).toBe(1);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });

  it('reads public POST limits from env with sensible fallbacks', () => {
    expect(parsePositiveInt('0', 9)).toBe(9);
    expect(parsePositiveInt('3', 9)).toBe(3);
    expect(parseJsonLimit('  ', '16kb')).toBe('16kb');
    expect(readPublicPostLimitsFromEnv({})).toEqual({
      leadJsonLimit: DEFAULT_LEAD_JSON_LIMIT,
      waiverJsonLimit: DEFAULT_WAIVER_SUBMIT_JSON_LIMIT,
      leadWindowMs: FIFTEEN_MINUTES_MS,
      waiverWindowMs: FIFTEEN_MINUTES_MS,
      leadMax: DEFAULT_LEAD_RATE_LIMIT_MAX,
      waiverMax: DEFAULT_WAIVER_SUBMIT_RATE_LIMIT_MAX,
    });
    expect(
      readPublicPostLimitsFromEnv({
        LEAD_JSON_LIMIT: '32kb',
        WAIVER_SUBMIT_JSON_LIMIT: '1mb',
        LEAD_RATE_LIMIT_WINDOW_MS: '60000',
        WAIVER_SUBMIT_RATE_LIMIT_WINDOW_MS: '120000',
        LEAD_RATE_LIMIT_MAX: '20',
        WAIVER_SUBMIT_RATE_LIMIT_MAX: '8',
      }),
    ).toEqual({
      leadJsonLimit: '32kb',
      waiverJsonLimit: '1mb',
      leadWindowMs: 60_000,
      waiverWindowMs: 120_000,
      leadMax: 20,
      waiverMax: 8,
    });
  });
});

describe('public POST rate limit', () => {
  it('returns 429 JSON after the per-IP max', async () => {
    const app = createTestApp({ max: 2, name: `rl-${randomUUID()}` });
    const first = await request(app).post('/submit').send({ name: 'a' });
    const second = await request(app).post('/submit').send({ name: 'b' });
    const third = await request(app).post('/submit').send({ name: 'c' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('uses X-Forwarded-For when trust proxy is 1', async () => {
    const app = createTestApp({ max: 1, name: `xff-${randomUUID()}` });
    const a1 = await request(app).post('/submit').set('X-Forwarded-For', '203.0.113.10').send({});
    const a2 = await request(app).post('/submit').set('X-Forwarded-For', '203.0.113.10').send({});
    const b1 = await request(app).post('/submit').set('X-Forwarded-For', '203.0.113.11').send({});
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);
    expect(b1.status).toBe(200);
  });

  it('prefers CF-Connecting-IP when Cloudflare is in front of Render', async () => {
    const app = createTestApp({ max: 1, name: `cf-${randomUUID()}` });
    const sharedForwarded = '198.51.100.9, 10.0.0.1';
    const first = await request(app)
      .post('/submit')
      .set('X-Forwarded-For', sharedForwarded)
      .set('CF-Connecting-IP', '203.0.113.20')
      .send({});
    const sameClient = await request(app)
      .post('/submit')
      .set('X-Forwarded-For', sharedForwarded)
      .set('CF-Connecting-IP', '203.0.113.20')
      .send({});
    const otherClient = await request(app)
      .post('/submit')
      .set('X-Forwarded-For', sharedForwarded)
      .set('CF-Connecting-IP', '203.0.113.21')
      .send({});
    expect(first.status).toBe(200);
    expect(sameClient.status).toBe(429);
    expect(otherClient.status).toBe(200);
  });
});

describe('public POST JSON body limit', () => {
  it('rejects oversized JSON with 413 payload_too_large', async () => {
    const app = createTestApp({ jsonLimit: '100b', max: 50, name: `sz-${randomUUID()}` });
    const res = await request(app)
      .post('/submit')
      .set('Content-Type', 'application/json')
      .send(`{"notes":"${'n'.repeat(200)}"}`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ ok: false, error: 'payload_too_large' });
  });

  it('accepts a dense-but-realistic waiver JSON body under 512kb', async () => {
    const points = Array.from({ length: 2000 }, (_, i) => ({
      time: i * 16,
      x: i % 400,
      y: i % 180,
      pressure: 0.5,
    }));
    const app = createTestApp({ jsonLimit: '512kb', max: 5, name: `sz-ok-${randomUUID()}` });
    const res = await request(app)
      .post('/submit')
      .send({
        signature: { pngDataUrl: TINY_PNG_DATA_URL, vectorJson: [{ color: '#000', points }] },
        turnstileToken: 't'.repeat(2048),
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, handled: true });
  });
});

describe('honeypot', () => {
  it('silently accepts filled website and does not call the handler', async () => {
    const handler = vi.fn((_req, res) => res.json({ ok: true, handled: true }));
    const app = createTestApp({ handler, name: `hp-${randomUUID()}` });
    const res = await request(app)
      .post('/submit')
      .send({ firstName: 'Bot', [HONEYPOT_FIELD]: 'https://spam.example' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows omitted or blank honeypot fields through', async () => {
    const app = createTestApp({ name: `hp-empty-${randomUUID()}` });
    const omitted = await request(app).post('/submit').send({ firstName: 'Jane' });
    const blank = await request(app).post('/submit').send({ firstName: 'Jane', website: '  ' });
    expect(omitted.body).toEqual({ ok: true, handled: true });
    expect(blank.body).toEqual({ ok: true, handled: true });
  });
});

describe('Turnstile', () => {
  it('warns once and allows the request when the secret is unset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createTestApp({ getSecret: () => '', name: `ts-off-${randomUUID()}` });
    const first = await request(app).post('/submit').send({});
    const second = await request(app).post('/submit').send({});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(TURNSTILE_UNSET_WARNING);
  });

  it('rejects missing tokens before the handler when the secret is set', async () => {
    const fetchImpl = vi.fn();
    const handler = vi.fn((_req, res) => res.json({ ok: true, handled: true }));
    const app = createTestApp({
      getSecret: () => 'test-turnstile-secret',
      fetchImpl,
      handler,
      name: `ts-miss-${randomUUID()}`,
    });
    const res = await request(app).post('/submit').send({ firstName: 'Jane' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'turnstile_failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('verifies turnstileToken via siteverify before side effects', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ success: true }) }));
    const handler = vi.fn((_req, res) => res.json({ ok: true, handled: true }));
    const app = createTestApp({
      getSecret: () => 'test-turnstile-secret',
      fetchImpl,
      handler,
      name: `ts-ok-${randomUUID()}`,
    });
    const res = await request(app).post('/submit').send({ turnstileToken: 'valid-token' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, handled: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('response=valid-token');
    expect(String(init.body)).toContain('secret=test-turnstile-secret');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed siteverify response and skips the handler', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ success: false }) }));
    const handler = vi.fn((_req, res) => res.json({ ok: true, handled: true }));
    const app = createTestApp({
      getSecret: () => 'test-turnstile-secret',
      fetchImpl,
      handler,
      name: `ts-fail-${randomUUID()}`,
    });
    const res = await request(app)
      .post('/submit')
      .send({ 'cf-turnstile-response': 'bad-token' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'turnstile_failed' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('waiver submit side effects stay behind the guard', () => {
  function createIsolatedSupabase() {
    const uploads = [];
    const inserts = [];
    const supabase = {
      from(table) {
        const builder = {
          select() {
            return builder;
          },
          insert(row) {
            inserts.push({ table, row });
            return builder;
          },
          eq() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { id: randomUUID() }, error: null }),
          then(onFulfilled) {
            return Promise.resolve({ data: [], error: null }).then(onFulfilled);
          },
        };
        return builder;
      },
      storage: {
        from(bucket) {
          return {
            async upload(key) {
              uploads.push({ bucket, key });
              return { error: null };
            },
          };
        },
      },
    };
    return { supabase, uploads, inserts };
  }

  const body = {
    participant: {
      full_name: 'Test Person',
      date_of_birth: '1990-01-15',
      email: 'tu-test-guard@tu-test.invalid',
      phone: '5551234567',
    },
    signature: { pngDataUrl: TINY_PNG_DATA_URL, vectorJson: [] },
    legal_confirmation: {
      accepted_terms: true,
      risk_initials: 'TP',
      release_initials: 'TP',
      indemnification_initials: 'TP',
      media_initials: 'TP',
    },
    review: { confirm_accuracy: true },
  };

  it('does not upload, insert, or notify when the honeypot is filled', async () => {
    const { supabase, uploads, inserts } = createIsolatedSupabase();
    const notify = vi.fn(async () => []);
    const app = express();
    app.set('trust proxy', 1);
    registerWaiverSubmitRoute(app, {
      supabase,
      signaturesBucket: 'signatures',
      waiversBucket: 'signed-waivers',
      notify,
      recordEvent: async () => ({ id: randomUUID(), occurredAt: new Date().toISOString(), eventName: 'waiver.submitted' }),
      middleware: createPublicPostMiddleware({
        name: `waiver-hp-${randomUUID()}`,
        jsonLimit: '512kb',
        windowMs: 60_000,
        max: 20,
        getSecret: () => '',
      }),
    });
    const res = await request(app)
      .post('/api/waivers/submit')
      .send({ ...body, website: 'http://bots.example' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(uploads).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not upload, insert, or notify when Turnstile siteverify fails', async () => {
    const { supabase, uploads, inserts } = createIsolatedSupabase();
    const notify = vi.fn(async () => []);
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ success: false }) }));
    const app = express();
    app.set('trust proxy', 1);
    registerWaiverSubmitRoute(app, {
      supabase,
      signaturesBucket: 'signatures',
      waiversBucket: 'signed-waivers',
      notify,
      recordEvent: async () => ({ id: randomUUID(), occurredAt: new Date().toISOString(), eventName: 'waiver.submitted' }),
      middleware: createPublicPostMiddleware({
        name: `waiver-ts-${randomUUID()}`,
        jsonLimit: '512kb',
        windowMs: 60_000,
        max: 20,
        getSecret: () => 'test-turnstile-secret',
        fetchImpl,
      }),
    });
    const res = await request(app)
      .post('/api/waivers/submit')
      .send({ ...body, turnstileToken: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'turnstile_failed' });
    expect(uploads).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
