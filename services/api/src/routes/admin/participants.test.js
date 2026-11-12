import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildParticipantSearchOrFilter } from '../../lib/adminRequestValidation.js';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { registerAdminParticipantRoutes } from './participants.js';

const ADMIN_KEY = 'api-participants-search-key';
const JANE_ID = '11111111-1111-4111-8111-111111111111';
const WILD_ID = '22222222-2222-4222-8222-222222222222';
const INJECT_ID = '33333333-3333-4333-8333-333333333333';
const ANN_X_ID = '44444444-4444-4444-8444-444444444444';

function splitPostgrestOr(filter) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  let escape = false;
  for (const ch of filter) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && inQuotes) {
      current += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function unquotePostgrestValue(raw) {
  if (!raw.startsWith('"')) return raw;
  const inner = raw.endsWith('"') ? raw.slice(1, -1) : raw.slice(1);
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function likeToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
      continue;
    }
    if (ch === '%') {
      source += '.*';
      continue;
    }
    if (ch === '_') {
      source += '.';
      continue;
    }
    source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

function createParticipantFixture(people) {
  const lastOrFilters = [];

  function matchesIlike(row, orFilter) {
    const terms = splitPostgrestOr(orFilter);
    const injected = terms.some((term) => /(?:^|\.)id\.(?:not\.)?is\.null/.test(term));
    if (injected) return true;
    return terms.some((term) => {
      const match = term.match(/^(\w+)\.ilike\.(.+)$/);
      if (!match) return false;
      const [, column, rawValue] = match;
      const pattern = unquotePostgrestValue(rawValue);
      const haystack = row[column];
      if (haystack == null) return false;
      return likeToRegExp(pattern).test(String(haystack));
    });
  }

  const supabase = {
    from(table) {
      const state = { table, orFilter: null, limit: null };
      const api = {
        select() {
          return api;
        },
        or(filter) {
          state.orFilter = filter;
          lastOrFilters.push(filter);
          return api;
        },
        in() {
          return api;
        },
        order() {
          return api;
        },
        limit(value) {
          state.limit = value;
          return api;
        },
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };

      function run() {
        if (table === 'account_members') {
          return { data: [], error: null };
        }
        if (table !== 'participants') {
          return { data: null, error: { message: `unknown_table:${table}` } };
        }
        let rows = people.filter((row) => (state.orFilter ? matchesIlike(row, state.orFilter) : true));
        if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
        return { data: rows.map((row) => ({ ...row })), error: null };
      }

      return api;
    },
  };

  return { supabase, lastOrFilters };
}

function createApp(supabase) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(requireAdmin);
  registerAdminParticipantRoutes(router, { supabase });
  app.use('/api/admin', router);
  return app;
}

function auth(req) {
  return req.set('x-admin-key', ADMIN_KEY);
}

describe('admin participant search', () => {
  let previousAdminKey;

  beforeEach(() => {
    previousAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
  });

  const people = [
    {
      id: JANE_ID,
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      cell_phone: '555-111-2222',
      home_phone: null,
      created_at: '2026-06-01T00:00:00.000Z',
    },
    {
      id: WILD_ID,
      full_name: 'Ann%Smith',
      email: 'wild@example.com',
      cell_phone: null,
      home_phone: null,
      created_at: '2026-06-02T00:00:00.000Z',
    },
    {
      id: INJECT_ID,
      full_name: 'a,id.not.is.null',
      email: 'inject@example.com',
      cell_phone: null,
      home_phone: null,
      created_at: '2026-06-03T00:00:00.000Z',
    },
    {
      id: ANN_X_ID,
      full_name: 'Ann_Smith',
      email: 'annx@example.com',
      cell_phone: null,
      home_phone: null,
      created_at: '2026-06-04T00:00:00.000Z',
    },
  ];

  it('quotes reserved characters so q cannot inject extra PostgREST filters', async () => {
    const fixture = createParticipantFixture(people);
    const q = 'a,id.not.is.null';
    const res = await auth(request(createApp(fixture.supabase)).get('/api/admin/participants/search').query({ q }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows.map((row) => row.participant_id)).toEqual([INJECT_ID]);
    expect(fixture.lastOrFilters[0]).toBe(buildParticipantSearchOrFilter(q));
    const terms = splitPostgrestOr(fixture.lastOrFilters[0]);
    expect(terms).toHaveLength(4);
    expect(terms.every((term) => /^(full_name|email|cell_phone|home_phone)\.ilike\."/.test(term))).toBe(
      true,
    );
  });

  it('matches % and _ in q literally', async () => {
    const fixture = createParticipantFixture(people);
    const app = createApp(fixture.supabase);

    const percent = await auth(request(app).get('/api/admin/participants/search').query({ q: 'Ann%' }));
    expect(percent.status).toBe(200);
    expect(percent.body.rows.map((row) => row.participant_id)).toEqual([WILD_ID]);

    const underscore = await auth(request(app).get('/api/admin/participants/search').query({ q: 'Ann_' }));
    expect(underscore.status).toBe(200);
    expect(underscore.body.rows.map((row) => row.participant_id)).toEqual([ANN_X_ID]);

    const both = await auth(request(app).get('/api/admin/participants/search').query({ q: 'Ann%Smith' }));
    expect(both.status).toBe(200);
    expect(both.body.rows.map((row) => row.participant_id)).toEqual([WILD_ID]);
  });

  it('rejects short and overlong q and invalid pagination', async () => {
    const fixture = createParticipantFixture(people);
    const app = createApp(fixture.supabase);

    const short = await auth(request(app).get('/api/admin/participants/search').query({ q: 'a' }));
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ ok: false, error: 'query_min_length_2' });

    const tooLong = await auth(
      request(app)
        .get('/api/admin/participants/search')
        .query({ q: 'ab'.repeat(41) }),
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ ok: false, error: 'query_too_long' });

    const badLimit = await auth(
      request(app).get('/api/admin/participants/search').query({ q: 'Jane', limit: '-5' }),
    );
    expect(badLimit.status).toBe(400);
    expect(badLimit.body).toEqual({ ok: false, error: 'invalid_pagination' });
  });
});
