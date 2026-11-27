export const SESSION_CONTENT_VISIBILITIES = Object.freeze(['staff', 'members', 'public']);
export const SESSION_CONTENT_DEFAULT_VISIBILITY = 'staff';
export const SESSION_CONTENT_NOTES_MAX = 8000;
export const SESSION_CONTENT_VIDEO_URL_MAX = 2048;

const VISIBILITY_SET = new Set(SESSION_CONTENT_VISIBILITIES);

/**
 * Staff notes. Omitted stays omitted. Null and blank become null. Other types fail.
 * @param {unknown} value
 * @returns {{ omitted: true } | { ok: true, value: string | null } | { ok: false }}
 */
export function parseSessionContentNotes(value) {
  if (value === undefined) return { omitted: true };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > SESSION_CONTENT_NOTES_MAX) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * Absolute https URL. Omitted stays omitted. Null and blank become null.
 * Scheme is normalized to lowercase https. Credentials, spaces, and other schemes fail.
 * @param {unknown} value
 * @returns {{ omitted: true } | { ok: true, value: string | null } | { ok: false }}
 */
export function parseSessionContentVideoUrl(value) {
  if (value === undefined) return { omitted: true };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > SESSION_CONTENT_VIDEO_URL_MAX) return { ok: false };
  if (/\s/.test(trimmed) || trimmed.includes('\\')) return { ok: false };

  const normalized = trimmed.replace(/^https:\/\//i, 'https://');
  let url;
  try {
    url = new URL(normalized);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'https:') return { ok: false };
  if (url.username || url.password) return { ok: false };
  if (!url.hostname) return { ok: false };
  return { ok: true, value: normalized };
}

/**
 * staff | members | public. Comparison is case-insensitive. Omitted stays omitted.
 * @param {unknown} value
 * @returns {{ omitted: true } | { ok: true, value: 'staff' | 'members' | 'public' } | { ok: false }}
 */
export function parseSessionContentVisibility(value) {
  if (value === undefined) return { omitted: true };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim().toLowerCase();
  if (!VISIBILITY_SET.has(trimmed)) return { ok: false };
  return { ok: true, value: /** @type {'staff' | 'members' | 'public'} */ (trimmed) };
}

function sameInstant(left, right) {
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

function sameLabel(sessionLabel, className) {
  if (typeof sessionLabel !== 'string' || typeof className !== 'string') return false;
  const left = sessionLabel.trim();
  const right = className.trim();
  return left.length > 0 && left === right;
}

/**
 * Flatten PostgREST embeds to public-calendar rows. Drops anything that is
 * not visibility=public so a missed query filter cannot leak staff or member notes.
 * @param {unknown} rows
 */
export function readPublicSessionContentRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!row || row.visibility !== 'public') continue;
    const session = row.sessions && !Array.isArray(row.sessions) ? row.sessions : null;
    if (!session) continue;
    const video = parseSessionContentVideoUrl(row.video_url ?? null);
    out.push({
      notes: typeof row.notes === 'string' ? row.notes : null,
      video_url: video.ok && !video.omitted ? video.value : null,
      visibility: 'public',
      starts_at: session.starts_at,
      session_label: session.session_label,
      cancelled_at: session.cancelled_at ?? null,
    });
  }
  return out;
}

/**
 * Public notes and video for one class occurrence.
 * A single non-cancelled session must share the occurrence instant and its
 * session_label must equal the class name. Zero or several matches yield null
 * so member/staff rows and ambiguous sessions stay off the public calendar.
 * @param {{ starts_at?: string, name?: string }} occurrence
 * @param {Array<Record<string, unknown>>} rows
 * @returns {{ notes: string | null, video_url: string | null, visibility: 'public' } | null}
 */
export function publicSessionContentForOccurrence(occurrence, rows) {
  if (!occurrence) return null;
  const matches = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.visibility !== 'public') continue;
    if (row.cancelled_at) continue;
    if (!sameInstant(row.starts_at, occurrence.starts_at)) continue;
    if (!sameLabel(row.session_label, occurrence.name)) continue;
    matches.push(row);
  }
  if (matches.length !== 1) return null;
  const row = matches[0];
  const video = parseSessionContentVideoUrl(row.video_url ?? null);
  return {
    notes: typeof row.notes === 'string' ? row.notes : null,
    video_url: video.ok && !video.omitted ? video.value : null,
    visibility: 'public',
  };
}

/**
 * Copy occurrences, adding `content` only when public session content matches.
 * Occurrences without a public match are unchanged (no content key).
 * @param {Array<Record<string, unknown>>} occurrences
 * @param {Array<Record<string, unknown>>} rows
 */
export function attachPublicSessionContent(occurrences, rows) {
  return (Array.isArray(occurrences) ? occurrences : []).map((occurrence) => {
    const content = publicSessionContentForOccurrence(occurrence, rows);
    if (!content) return occurrence;
    return { ...occurrence, content };
  });
}
