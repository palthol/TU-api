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

  beforeEach(() => {
    previousAllowedOrigin = process.env.ALLOWED_ORIGIN;
    delete process.env.ALLOWED_ORIGIN;
  });

  afterEach(() => {
    if (previousAllowedOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previousAllowedOrigin;
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
  });

  it('does not emit Access-Control-Allow-Origin for unlisted origins', async () => {
    process.env.ALLOWED_ORIGIN = 'https://allowed.test';
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://unlisted.test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
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
    expect(String(res.headers['access-control-allow-methods'] || '')).toMatch(/\bGET\b/);
    expect(String(res.headers['access-control-allow-headers'] || '').toLowerCase()).toContain('content-type');
  });

  it('treats missing/empty ALLOWED_ORIGIN as allow-all', async () => {
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://anything.test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('treats ALLOWED_ORIGIN that includes * as allow-all', async () => {
    process.env.ALLOWED_ORIGIN = 'https://a.test, * , https://b.test';
    const app = createAppWithCors();

    const res = await request(app).get('/ping').set('Origin', 'https://anything.test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

