import { describe, expect, it } from 'vitest';
import {
  SEARCH_QUERY_MAX_LENGTH,
  buildParticipantSearchOrFilter,
  escapeIlikeLiteral,
  parseAttendanceRecordsBody,
  parseIsoDate,
  parseIsoDateTime,
  parseOptionalNullableString,
  parsePagination,
  parseSearchQuery,
  parseUuid,
  quotePostgrestFilterValue,
} from './adminRequestValidation.js';

describe('adminRequestValidation', () => {
  it('parses UUIDs', () => {
    const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    expect(parseUuid(id)).toBe(id);
    expect(parseUuid('not-a-uuid')).toBeNull();
  });

  it('parses ISO dates', () => {
    expect(parseIsoDate('2026-06-01')).toBe('2026-06-01');
    expect(parseIsoDate('06-01-2026')).toBeNull();
  });

  it('parses ISO datetimes', () => {
    const iso = parseIsoDateTime('2026-06-01T19:00:00.000Z');
    expect(iso).toBe('2026-06-01T19:00:00.000Z');
  });

  it('parses attendance records body', () => {
    const participantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const parsed = parseAttendanceRecordsBody({
      records: [{ participant_id: participantId, status: 'present' }],
    });
    expect('records' in parsed).toBe(true);
    if ('records' in parsed) {
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].status).toBe('present');
    }
  });

  it('rejects empty attendance records', () => {
    expect(parseAttendanceRecordsBody({ records: [] }).error).toBe('records_required');
  });

  describe('parsePagination', () => {
    it('uses defaults when limit and offset are omitted', () => {
      expect(parsePagination({})).toEqual({ ok: true, limit: 50, offset: 0 });
      expect(parsePagination({ limit: '', offset: '' })).toEqual({ ok: true, limit: 50, offset: 0 });
    });

    it('rejects non-numeric, zero, and negative values with invalid_pagination', () => {
      expect(parsePagination({ limit: '-5' })).toEqual({ ok: false, error: 'invalid_pagination' });
      expect(parsePagination({ limit: '0' })).toEqual({ ok: false, error: 'invalid_pagination' });
      expect(parsePagination({ limit: 'abc' })).toEqual({ ok: false, error: 'invalid_pagination' });
      expect(parsePagination({ limit: '1.5' })).toEqual({ ok: false, error: 'invalid_pagination' });
      expect(parsePagination({ offset: '-1' })).toEqual({ ok: false, error: 'invalid_pagination' });
      expect(parsePagination({ offset: 'abc' })).toEqual({ ok: false, error: 'invalid_pagination' });
    });

    it('clamps limit 1000 to 200 and accepts a valid page', () => {
      expect(parsePagination({ limit: '1000', offset: '10' })).toEqual({
        ok: true,
        limit: 200,
        offset: 10,
      });
      expect(parsePagination({ limit: 25, offset: 0 })).toEqual({ ok: true, limit: 25, offset: 0 });
    });

    it('honors per-route default and max limits', () => {
      expect(parsePagination({ limit: '1000' }, { defaultLimit: 8, maxLimit: 25 })).toEqual({
        ok: true,
        limit: 25,
        offset: 0,
      });
    });
  });

  describe('participant search filters', () => {
    it('rejects short and overlong q', () => {
      expect(parseSearchQuery('a')).toEqual({ ok: false, error: 'query_min_length_2' });
      expect(parseSearchQuery('  x  ')).toEqual({ ok: false, error: 'query_min_length_2' });
      expect(parseSearchQuery('a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1))).toEqual({
        ok: false,
        error: 'query_too_long',
      });
      expect(parseSearchQuery('Jane')).toEqual({ ok: true, q: 'Jane' });
    });

    it('quotes reserved PostgREST characters and escapes LIKE wildcards', () => {
      expect(escapeIlikeLiteral('100%_off')).toBe('100\\%\\_off');
      expect(quotePostgrestFilterValue('a,id.not.is.null')).toBe('"a,id.not.is.null"');
      expect(quotePostgrestFilterValue('say "hi"')).toBe('"say \\"hi\\""');

      const injected = buildParticipantSearchOrFilter('a,id.not.is.null');
      expect(injected).toBe(
        'full_name.ilike."%a,id.not.is.null%",email.ilike."%a,id.not.is.null%",cell_phone.ilike."%a,id.not.is.null%",home_phone.ilike."%a,id.not.is.null%"',
      );
      expect(injected.startsWith('full_name.ilike."')).toBe(true);

      const wild = buildParticipantSearchOrFilter('100%_club');
      expect(wild).toContain('ilike."%100\\\\%\\\\_club%"');
    });
  });

  it('parses optional nullable strings without coercing objects', () => {
    expect(parseOptionalNullableString(undefined)).toEqual({ omitted: true });
    expect(parseOptionalNullableString(null)).toEqual({ ok: true, value: null });
    expect(parseOptionalNullableString('  hi  ')).toEqual({ ok: true, value: 'hi' });
    expect(parseOptionalNullableString('   ')).toEqual({ ok: true, value: null });
    expect(parseOptionalNullableString(12)).toEqual({ ok: false });
    expect(parseOptionalNullableString({ text: 'nope' })).toEqual({ ok: false });
  });
});
