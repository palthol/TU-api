const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ATTENDANCE_STATUSES = new Set(['present', 'no_show', 'cancelled']);

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
