import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAllowedOriginsEnv, registerCors } from './index.js';

describe('CORS allowed origin parsing', () => {
  it('treats missing/empty values as wildcard', () => {
    expect(parseAllowedOriginsEnv(undefined)).toEqual({ mode: 'any' });
    expect(parseAllowedOriginsEnv('')).toEqual({ mode: 'any' });
    expect(parseAllowedOriginsEnv('   ')).toEqual({ mode: 'any' });
    expect(parseAllowedOriginsEnv('*')).toEqual({ mode: 'any' });
  });

  it('accepts a single origin', () => {
    expect(parseAllowedOriginsEnv('https://example.com')).toEqual({
      mode: 'list',
      origins: ['https://example.com'],
    });
  });

  it('accepts comma-separated origins (trimmed)', () => {
    expect(parseAllowedOriginsEnv('https://a.test, https://b.test')).toEqual({
      mode: 'list',
      origins: ['https://a.test', 'https://b.test'],
    });
  });

  it('treats any list including * as wildcard', () => {
    expect(parseAllowedOriginsEnv('https://a.test, *')).toEqual({ mode: 'any' });
  });
});

describe('CORS headers', () => {
  let previousAllowedOrigin;
  let previousAdminAllowedOrigins;

  beforeEach(() => {
    previousAllowedOrigin = process.env.ALLOWED_ORIGIN;
    previousAdminAllowedOrigins = process.env.ADMIN_ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGIN;
    delete process.env.ADMIN_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (previousAllowedOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previousAllowedOrigin;
    if (previousAdminAllowedOrigins === undefined) delete process.env.ADMIN_ALLOWED_ORIGINS;
    else process.env.ADMIN_ALLOWED_ORIGINS = previousAdminAllowedOrigins;
  });

  function createAppWithCors() {
    const app = express();
    registerCors(app);
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('echoes back exactly the requesting origin when it is listed', async () => {
    process.env.ALLOWED_ORIGIN =
      'https://waiver.templeunderground.com,https://finance.templeunderground.com,https://admin.templeunderground.com,https://waiverviewer.templeunderground.com';
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://waiverviewer.templeunderground.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://waiverviewer.templeunderground.com');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(String(res.headers.vary || '')).toMatch(/Origin/i);
  });

  it('sends credentials only for ADMIN_ALLOWED_ORIGINS, not public ALLOWED_ORIGIN sites', async () => {
    process.env.ALLOWED_ORIGIN = 'https://waiver.templeunderground.com,https://admin.templeunderground.com';
    process.env.ADMIN_ALLOWED_ORIGINS = 'https://admin.templeunderground.com';
    const app = createAppWithCors();

    const admin = await request(app).get('/ping').set('Origin', 'https://admin.templeunderground.com');
    expect(admin.headers['access-control-allow-origin']).toBe('https://admin.templeunderground.com');
    expect(admin.headers['access-control-allow-credentials']).toBe('true');

    const publicSite = await request(app).get('/ping').set('Origin', 'https://waiver.templeunderground.com');
    expect(publicSite.headers['access-control-allow-origin']).toBe('https://waiver.templeunderground.com');
    expect(publicSite.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not send credentials when ADMIN_ALLOWED_ORIGINS is unset', async () => {
    process.env.ALLOWED_ORIGIN = 'https://admin.templeunderground.com';
    const app = createAppWithCors();
    const res = await request(app).get('/ping').set('Origin', 'https://admin.templeunderground.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://admin.templeunderground.com');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not emit Access-Control-Allow-Origin for unlisted origins', async () => {
    process.env.ALLOWED_ORIGIN = 'https://allowed.test';
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://unlisted.test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('handles OPTIONS preflight for a listed origin with correct headers', async () => {
    process.env.ALLOWED_ORIGIN = 'https://allowed.test';
    const app = createAppWithCors();

    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://allowed.test')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://allowed.test');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(String(res.headers['access-control-allow-methods'] || '')).toMatch(/\bGET\b/);
    expect(String(res.headers['access-control-allow-headers'] || '').toLowerCase()).toContain('content-type');
  });

  it('handles OPTIONS preflight on nested paths after the Express 5 splat syntax change', async () => {
    process.env.ALLOWED_ORIGIN = 'https://allowed.test';
    const app = createAppWithCors();

    const res = await request(app)
      .options('/api/admin/billing/record-payment')
      .set('Origin', 'https://allowed.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-admin-key');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://allowed.test');
    expect(String(res.headers['access-control-allow-methods'] || '')).toMatch(/\bPOST\b/);
  });

  it('treats missing/empty ALLOWED_ORIGIN as allow-all', async () => {
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://anything.test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('treats ALLOWED_ORIGIN that includes * as allow-all', async () => {
    process.env.ALLOWED_ORIGIN = 'https://a.test, * , https://b.test';
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://anything.test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('Express 5 query parser default', () => {
  it('keeps nested qs keys as literal strings under the simple parser', async () => {
    const app = express();
    app.get('/search', (req, res) => res.json({ query: req.query }));

    const res = await request(app).get('/search').query({ 'a[b]': '1', c: '2' });
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ 'a[b]': '1', c: '2' });
  });
});

