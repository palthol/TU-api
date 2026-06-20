import { describe, expect, it } from 'vitest';
import {
  parseAttendanceRecordsBody,
  parseIsoDate,
  parseIsoDateTime,
  parseUuid,
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
});
