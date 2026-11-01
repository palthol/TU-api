import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATABASE_ERROR_KEYS,
  exposeSupabaseError,
  isStableMachineKey,
  mapDatabaseError,
  sendDatabaseError,
} from './exposeSupabaseError.js';

const RAW_FK = {
  code: '23503',
  message:
    'insert or update on table "sessions" violates foreign key constraint "sessions_schedule_template_id_fkey"',
  details: 'Key (schedule_template_id)=(11111111-1111-4111-8111-111111111111) is not present in table "schedule_templates".',
  hint: 'Check the schedule_template_id',
};

const RAW_UNIQUE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "schedule_templates_pkey"',
  details: 'Key (id)=(11111111-1111-4111-8111-111111111111) already exists.',
};

function assertNoRawDbText(payload) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/violates (foreign key|unique) constraint/i);
  expect(serialized).not.toMatch(/duplicate key value/i);
  expect(serialized).not.toMatch(/schedule_templates/i);
  expect(serialized).not.toMatch(/sessions_schedule_template_id_fkey/i);
  expect(payload).not.toHaveProperty('message');
  expect(payload).not.toHaveProperty('details');
  expect(payload).not.toHaveProperty('hint');
}

describe('mapDatabaseError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps foreign-key violations to related_record_not_found without leaking SQL', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = mapDatabaseError(RAW_FK, { context: 'sessions.insert' });
    expect(mapped.status).toBe(400);
    expect(mapped.body).toEqual({ ok: false, error: DATABASE_ERROR_KEYS.RELATED_RECORD_NOT_FOUND });
    assertNoRawDbText(mapped.body);
    expect(log).toHaveBeenCalledWith('sessions.insert', {
      code: '23503',
      message: RAW_FK.message,
    });
  });

  it('lets a read path return 404 for foreign-key violations', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = mapDatabaseError(RAW_FK, { relatedRecordStatus: 404, log: false });
    expect(mapped).toEqual({
      status: 404,
      body: { ok: false, error: DATABASE_ERROR_KEYS.RELATED_RECORD_NOT_FOUND },
    });
  });

  it('maps unique violations to 409 already_exists or a route-specific key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mapDatabaseError(RAW_UNIQUE, { log: false })).toEqual({
      status: 409,
      body: { ok: false, error: DATABASE_ERROR_KEYS.ALREADY_EXISTS },
    });
    expect(
      mapDatabaseError(RAW_UNIQUE, { alreadyExistsKey: 'email_taken', log: false }),
    ).toEqual({
      status: 409,
      body: { ok: false, error: 'email_taken' },
    });
  });

  it.each([
    ['23514', 'new row violates check constraint "charges_amount_positive"'],
    ['22P02', 'invalid input syntax for type uuid: "nope"'],
    ['23502', 'null value in column "account_id" of relation "charges" violates not-null constraint'],
  ])('maps %s to invalid_input', (code, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = mapDatabaseError({ code, message, details: message }, { log: false });
    expect(mapped.status).toBe(400);
    expect(mapped.body.error).toBe(DATABASE_ERROR_KEYS.INVALID_INPUT);
    assertNoRawDbText(mapped.body);
  });

  it('maps PGRST116 to 404 not_found', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = mapDatabaseError(
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      { log: false },
    );
    expect(mapped).toEqual({
      status: 404,
      body: { ok: false, error: DATABASE_ERROR_KEYS.NOT_FOUND },
    });
  });

  it('keeps route-specific RPC machine keys and their statuses', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mapDatabaseError({ message: 'charge_not_found' }, { log: false })).toEqual({
      status: 400,
      body: { ok: false, error: 'charge_not_found' },
    });
    expect(mapDatabaseError({ message: 'template_not_found' }, { log: false })).toEqual({
      status: 404,
      body: { ok: false, error: 'template_not_found' },
    });
    expect(mapDatabaseError({ message: 'idempotency_key_conflict' }, { log: false })).toEqual({
      status: 409,
      body: { ok: false, error: 'idempotency_key_conflict' },
    });
    expect(
      mapDatabaseError({ message: 'replacement_overlaps_existing_charge' }, { log: false }),
    ).toEqual({
      status: 400,
      body: { ok: false, error: 'replacement_overlaps_existing_charge' },
    });
  });

  it('maps unknown SQL text to 500 internal_error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = mapDatabaseError(
      { message: 'permission denied for function generate_monthly_charges' },
      { log: false },
    );
    expect(mapped).toEqual({
      status: 500,
      body: { ok: false, error: DATABASE_ERROR_KEYS.INTERNAL_ERROR },
    });
  });

  it('never returns details or hint even when extra fields are attached', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = mapDatabaseError(RAW_FK, {
      extra: { payment_id: 'pay_1' },
      log: false,
    });
    expect(mapped.body).toEqual({
      ok: false,
      error: DATABASE_ERROR_KEYS.RELATED_RECORD_NOT_FOUND,
      payment_id: 'pay_1',
    });
    assertNoRawDbText(mapped.body);
  });
});

describe('sendDatabaseError / exposeSupabaseError', () => {
  it('writes the mapped envelope onto the response', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    sendDatabaseError(res, RAW_UNIQUE, { context: 'templates.insert' });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ ok: false, error: DATABASE_ERROR_KEYS.ALREADY_EXISTS });
  });

  it('never exposes raw supabase fields to clients', () => {
    expect(exposeSupabaseError(RAW_FK)).toBeUndefined();
    expect(exposeSupabaseError(RAW_UNIQUE)).toBeUndefined();
  });

  it('recognizes stable machine keys only', () => {
    expect(isStableMachineKey('already_exists')).toBe(true);
    expect(isStableMachineKey('participant not found')).toBe(false);
    expect(isStableMachineKey('duplicate key value')).toBe(false);
  });
});
