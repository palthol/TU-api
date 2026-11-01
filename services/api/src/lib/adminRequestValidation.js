const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGER_RE = /^-?\d+$/;

export const ATTENDANCE_STATUSES = new Set(['present', 'no_show', 'cancelled']);
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 80;

/**
 * Parse a query integer. Omitted / empty uses `omittedDefault`.
 * Non-numeric, non-integer, or arrays are invalid.
 * @param {unknown} value
 * @param {number} omittedDefault
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
function parseOptionalQueryInt(value, omittedDefault) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: omittedDefault };
  }
  if (Array.isArray(value)) return { ok: false };
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) return { ok: false };
    return { ok: true, value };
  }
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: omittedDefault };
  if (!INTEGER_RE.test(trimmed)) return { ok: false };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

/**
 * Shared list pagination.
 *
 * - omitted / empty `limit` → `defaultLimit` (50 unless overridden)
 * - omitted / empty `offset` → 0
 * - provided non-integer / non-numeric → `{ ok: false, error: 'invalid_pagination' }`
 * - `limit < 1` or `offset < 0` → `invalid_pagination` (not silently coerced)
 * - `limit` above `maxLimit` is clamped (200 unless overridden)
 *
 * @param {Record<string, unknown> | undefined | null} query
 * @param {{ defaultLimit?: number, maxLimit?: number }} [options]
 * @returns {{ ok: true, limit: number, offset: number } | { ok: false, error: 'invalid_pagination' }}
 */
export function parsePagination(query, options = {}) {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_PAGE_LIMIT;
  const source = query && typeof query === 'object' ? query : {};

  const limitParsed = parseOptionalQueryInt(source.limit, defaultLimit);
  const offsetParsed = parseOptionalQueryInt(source.offset, 0);
  if (!limitParsed.ok || !offsetParsed.ok) {
    return { ok: false, error: 'invalid_pagination' };
  }
  if (limitParsed.value < 1 || offsetParsed.value < 0) {
    return { ok: false, error: 'invalid_pagination' };
  }

  return {
    ok: true,
    limit: Math.min(limitParsed.value, maxLimit),
    offset: offsetParsed.value,
  };
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, q: string } | { ok: false, error: 'query_min_length_2' | 'query_too_long' }}
 */
export function parseSearchQuery(value) {
  if (typeof value !== 'string') {
    return { ok: false, error: 'query_min_length_2' };
  }
  const q = value.trim();
  if (q.length < SEARCH_QUERY_MIN_LENGTH) {
    return { ok: false, error: 'query_min_length_2' };
  }
  if (q.length > SEARCH_QUERY_MAX_LENGTH) {
    return { ok: false, error: 'query_too_long' };
  }
  return { ok: true, q };
}

/**
 * Escape `\\`, `%`, and `_` so a LIKE / ILIKE pattern matches the input literally.
 * @param {string} value
 */
export function escapeIlikeLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Quote a PostgREST filter value so commas, parentheses, dots, and quotes
 * cannot introduce extra `.or()` terms.
 * @param {string} value
 */
export function quotePostgrestFilterValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Participant search `.or(...)` filter: literal ILIKE across name/email/phones.
 * @param {string} q
 */
export function buildParticipantSearchOrFilter(q) {
  const like = `%${escapeIlikeLiteral(q)}%`;
  const quoted = quotePostgrestFilterValue(like);
  return ['full_name', 'email', 'cell_phone', 'home_phone']
    .map((column) => `${column}.ilike.${quoted}`)
    .join(',');
}

/**
 * Optional JSON string field. Wrong types are rejected; blank becomes null.
 * @param {unknown} value
 * @returns {{ omitted: true } | { ok: true, value: string | null } | { ok: false }}
 */
export function parseOptionalNullableString(value) {
  if (value === undefined) return { omitted: true };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

/** @param {unknown} value */
export function parseUuid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/** @param {unknown} value */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

/** @param {unknown} value */
export function parseIsoDateTime(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * @param {unknown} body
 * @returns {{ records: Array<{ participant_id: string, status: string, recorded_by: string | null }> } | { error: string }}
 */
export function parseAttendanceRecordsBody(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid_body' };
  const raw = body.records;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'records_required' };
  }
  if (raw.length > 200) {
    return { error: 'records_too_many' };
  }

  const records = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return { error: 'invalid_record' };
    const participantId = parseUuid(row.participant_id);
    if (!participantId) return { error: 'invalid_participant_id' };
    const status =
      typeof row.status === 'string' && ATTENDANCE_STATUSES.has(row.status.trim())
        ? row.status.trim()
        : 'present';
    const recordedBy =
      typeof row.recorded_by === 'string' && row.recorded_by.trim()
        ? row.recorded_by.trim()
        : null;
    records.push({ participant_id: participantId, status, recorded_by: recordedBy });
  }
  return { records };
}
