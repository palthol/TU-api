import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  DERIVED_IDEMPOTENCY_PREFIX,
  deriveWaiverIdempotencyKey,
  parseClientIdempotencyKey,
  registerWaiverSubmitRoute,
} from './submitWaiver.js';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z2wAAAABJRU5ErkJggg==';

function createIsolatedSupabase({ seed = {} } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }
  const uploads = [];

  function matches(row, filters) {
    return filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      return true;
    });
  }

  function execute(state, mode) {
    return Promise.resolve().then(() => {
      if (!tables[state.table]) tables[state.table] = [];

      if (state.action === 'insert') {
        const payload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        if (state.table === 'waivers' && payload.idempotency_key) {
          const dup = tables.waivers.find((row) => row.idempotency_key === payload.idempotency_key);
          if (dup) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            };
          }
        }
        const now = new Date().toISOString();
        const row = {
          id: payload.id || randomUUID(),
          created_at: now,
          signed_at_utc: payload.signed_at_utc || now,
          occurred_at: payload.occurred_at || now,
          ...payload,
        };
        tables[state.table].push(row);
        if (mode === 'many') return { data: [row], error: null };
        return { data: row, error: null };
      }

      let rows = tables[state.table].filter((row) => matches(row, state.filters));
      if (state.limit != null) rows = rows.slice(0, state.limit);
      if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
      if (mode === 'single') {
        return rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'not found' } };
      }
      return { data: rows, error: null };
    });
  }

  const supabase = {
    from(table) {
      const state = { table, action: 'select', payload: null, filters: [], limit: null };
      const builder = {
        select() {
          return builder;
        },
        insert(row) {
          state.action = 'insert';
          state.payload = row;
          return builder;
        },
        eq(col, val) {
          state.filters.push(['eq', col, val]);
          return builder;
        },
        order() {
          return builder;
        },
        limit(n) {
          state.limit = n;
          return builder;
        },
        maybeSingle() {
          return execute(state, 'maybeSingle');
        },
        single() {
          return execute(state, 'single');
        },
        then(onFulfilled, onRejected) {
          return execute(state, 'many').then(onFulfilled, onRejected);
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

  return { supabase, tables, uploads };
}

function validSubmitBody(overrides = {}) {
  return {
    participant: {
      full_name: 'Test Person',
      date_of_birth: '1990-01-15',
      email: 'tu-test-hard002@tu-test.invalid',
      phone: '5551234567',
      ...(overrides.participant || {}),
    },
    signature: {
      pngDataUrl: TINY_PNG_DATA_URL,
      vectorJson: [],
      ...(overrides.signature || {}),
    },
    legal_confirmation: {
      accepted_terms: true,
      risk_initials: 'TP',
      release_initials: 'TP',
      indemnification_initials: 'TP',
      media_initials: 'TP',
      ...(overrides.legal_confirmation || {}),
    },
    review: { confirm_accuracy: true, ...(overrides.review || {}) },
    locale: overrides.locale ?? 'en',
    content_version: overrides.content_version ?? 'waiver.v1',
    ...(overrides.idempotency_key != null ? { idempotency_key: overrides.idempotency_key } : {}),
    ...(overrides.emergency_contact ? { emergency_contact: overrides.emergency_contact } : {}),
    ...(overrides.medical_information ? { medical_information: overrides.medical_information } : {}),
  };
}

function createSubmitApp({ supabase, notify, recordEvent }) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  registerWaiverSubmitRoute(app, {
    supabase,
    signaturesBucket: 'signatures',
    waiversBucket: 'signed-waivers',
    notify: notify ?? (async () => []),
    recordEvent:
      recordEvent ??
      (async () => ({
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        eventName: 'waiver.submitted',
      })),
  });
  return app;
}

describe('waiver submit idempotency key helpers', () => {
  it('treats omitted or blank client keys as absent', () => {
    expect(parseClientIdempotencyKey(undefined)).toEqual({ key: null });
    expect(parseClientIdempotencyKey('  ')).toEqual({ key: null });
  });

  it('rejects non-string or oversized client keys', () => {
    expect(parseClientIdempotencyKey(12).error.field).toBe('idempotency_key');
    expect(parseClientIdempotencyKey('k'.repeat(201)).error.messageKey).toBe('validation.invalid');
  });

  it('derives a stable key from identity + content_version + signature bytes', () => {
    const signatureBytes = Buffer.from('abc');
    const a = deriveWaiverIdempotencyKey({
      email: 'A@Example.com',
      dateOfBirth: '1990-01-15',
      phone: '5551234567',
      contentVersion: 'waiver.v1',
      signatureBytes,
    });
    const b = deriveWaiverIdempotencyKey({
      email: 'a@example.com',
      dateOfBirth: '1990-01-15',
      phone: '5551234567',
      contentVersion: 'waiver.v1',
      signatureBytes,
    });
    expect(a).toBe(b);
    expect(a.startsWith(DERIVED_IDEMPOTENCY_PREFIX)).toBe(true);
  });
});

describe('POST /api/waivers/submit', () => {
  it('creates participant, account bind, and waiver on first submit', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const notify = vi.fn(async () => [{ provider: 'discord', ok: true }]);
    const app = createSubmitApp({ supabase, notify });

    const res = await request(app).post('/api/waivers/submit').send(validSubmitBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        waiverId: expect.any(String),
        participantId: expect.any(String),
        accountId: expect.any(String),
        accountMemberId: expect.any(String),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(tables.participants).toHaveLength(1);
    expect(tables.accounts).toHaveLength(1);
    expect(tables.account_members).toHaveLength(1);
    expect(tables.waivers).toHaveLength(1);
    expect(tables.waivers[0].idempotency_key).toMatch(/^derived:v1:/);
    expect(tables.audit_trails).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('replays the original success envelope on an immediate duplicate submit', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const notify = vi.fn(async () => []);
    const app = createSubmitApp({ supabase, notify });
    const body = validSubmitBody({ idempotency_key: 'client-intent-1' });

    const first = await request(app).post('/api/waivers/submit').send(body);
    const second = await request(app).post('/api/waivers/submit').send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(tables.waivers).toHaveLength(1);
    expect(tables.participants).toHaveLength(1);
    expect(tables.accounts).toHaveLength(1);
    expect(tables.account_members).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('replays derived-key duplicates when the client omits idempotency_key', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const app = createSubmitApp({ supabase });
    const body = validSubmitBody();

    const first = await request(app).post('/api/waivers/submit').send(body);
    const second = await request(app).post('/api/waivers/submit').send(body);

    expect(second.body.waiverId).toBe(first.body.waiverId);
    expect(second.body.sha256).toBe(first.body.sha256);
    expect(tables.waivers).toHaveLength(1);
  });

  it('does not fail HTTP 200 when notification throws after persist', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const notify = vi.fn(() => {
      throw new Error('discord down');
    });
    const app = createSubmitApp({ supabase, notify });

    const res = await request(app).post('/api/waivers/submit').send(validSubmitBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(tables.waivers).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not fail HTTP 200 when notification returns a rejected promise', async () => {
    const { supabase } = createIsolatedSupabase();
    const notify = vi.fn(async () => {
      throw new Error('slack down');
    });
    const app = createSubmitApp({ supabase, notify });

    const res = await request(app).post('/api/waivers/submit').send(validSubmitBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('leaves validation failures unchanged', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const app = createSubmitApp({ supabase });

    const res = await request(app).post('/api/waivers/submit').send({
      participant: { full_name: 'X', date_of_birth: '', email: '', phone: '' },
      legal_confirmation: { accepted_terms: false },
      signature: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
    const fields = res.body.errors.map((row) => row.field);
    expect(fields).toContain('participant.full_name');
    expect(fields).toContain('participant.date_of_birth');
    expect(fields).toContain('participant.email');
    expect(fields).toContain('participant.phone');
    expect(fields).toContain('legal_confirmation.accepted_terms');
    expect(fields).toContain('signature');
    expect(tables.waivers || []).toHaveLength(0);
  });

  it('returns 409 when a client idempotency_key is reused for a different participant', async () => {
    const { supabase } = createIsolatedSupabase();
    const app = createSubmitApp({ supabase });
    const key = 'shared-but-wrong-person';

    const first = await request(app)
      .post('/api/waivers/submit')
      .send(validSubmitBody({ idempotency_key: key }));
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/waivers/submit')
      .send(
        validSubmitBody({
          idempotency_key: key,
          participant: {
            full_name: 'Other Person',
            date_of_birth: '1988-05-05',
            email: 'other-tu-test@tu-test.invalid',
            phone: '5559990000',
          },
        }),
      );

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ ok: false, error: 'idempotency_key_conflict' });
  });

  it('creates a new waiver when the derived intent changes (new signature)', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const app = createSubmitApp({ supabase });
    const first = await request(app).post('/api/waivers/submit').send(validSubmitBody());
    const otherPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const second = await request(app)
      .post('/api/waivers/submit')
      .send(validSubmitBody({ signature: { pngDataUrl: otherPng, vectorJson: [] } }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.waiverId).not.toBe(first.body.waiverId);
    expect(tables.waivers).toHaveLength(2);
    expect(tables.participants).toHaveLength(1);
    expect(tables.accounts).toHaveLength(1);
  });

  it('replays when a unique-constraint race is detected on insert', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const originalFrom = supabase.from.bind(supabase);
    let waiverLookups = 0;
    supabase.from = (table) => {
      const builder = originalFrom(table);
      if (table !== 'waivers') return builder;
      const originalMaybeSingle = builder.maybeSingle.bind(builder);
      builder.maybeSingle = async () => {
        waiverLookups += 1;
        // First submit lookup + duplicate submit lookup miss so insert hits 23505.
        if (waiverLookups <= 2) return { data: null, error: null };
        return originalMaybeSingle();
      };
      return builder;
    };

    const app = createSubmitApp({ supabase });
    const body = validSubmitBody({ idempotency_key: 'race-key' });
    const first = await request(app).post('/api/waivers/submit').send(body);
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/waivers/submit').send(body);
    expect(second.status).toBe(200);
    expect(second.body.waiverId).toBe(first.body.waiverId);
    expect(tables.waivers).toHaveLength(1);
  });

  it('still persists a waiver if idempotency_key is not in the live schema yet', async () => {
    const { supabase, tables } = createIsolatedSupabase();
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      if (table === 'waivers') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: null,
            error: {
              code: 'PGRST204',
              message: "Could not find the 'idempotency_key' column of 'waivers' in the schema cache",
            },
          }),
          insert(row) {
            if (Object.prototype.hasOwnProperty.call(row, 'idempotency_key')) {
              return {
                select() {
                  return this;
                },
                single: async () => ({
                  data: null,
                  error: {
                    code: 'PGRST204',
                    message: "Could not find the 'idempotency_key' column of 'waivers' in the schema cache",
                  },
                }),
              };
            }
            return originalFrom(table).insert(row);
          },
        };
      }
      return originalFrom(table);
    };

    const app = createSubmitApp({ supabase });
    const res = await request(app).post('/api/waivers/submit').send(validSubmitBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(tables.waivers).toHaveLength(1);
    expect(tables.waivers[0].idempotency_key).toBeUndefined();
  });
});
