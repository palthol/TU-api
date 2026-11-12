const NY_TZ = 'America/New_York';

const DTF_CACHE = new Map();

function getDtf(timeZone) {
  const key = String(timeZone || '');
  const existing = DTF_CACHE.get(key);
  if (existing) return existing;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: key,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  DTF_CACHE.set(key, dtf);
  return dtf;
}

function readZonedParts(date, timeZone) {
  const parts = getDtf(timeZone).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type === 'year') out.year = Number(part.value);
    else if (part.type === 'month') out.month = Number(part.value);
    else if (part.type === 'day') out.day = Number(part.value);
    else if (part.type === 'hour') out.hour = Number(part.value);
    else if (part.type === 'minute') out.minute = Number(part.value);
    else if (part.type === 'second') out.second = Number(part.value);
  }
  return out;
}

function getTimeZoneOffsetMs(timeZone, utcInstantMs) {
  const date = new Date(utcInstantMs);
  const parts = readZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - utcInstantMs;
}

function sameWallClock(parts, want) {
  return (
    parts.year === want.year &&
    parts.month === want.month &&
    parts.day === want.day &&
    parts.hour === want.hour &&
    parts.minute === want.minute &&
    parts.second === want.second
  );
}

function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1900 || year > 2500) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseWallClockTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] ?? '00') };
}

/**
 * Convert a wall-clock datetime in a specific IANA timezone to a UTC Date.
 *
 * `disambiguation` is used only when the wall-clock repeats (fall-back DST):
 * - `earlier` chooses the first occurrence (typically DST offset)
 * - `later` chooses the second occurrence (typically standard offset)
 *
 * For non-existent wall-clock times (spring-forward DST), this throws a RangeError.
 */
export function zonedWallClockToUtc(
  {
    timeZone,
    year,
    month,
    day,
    hour,
    minute,
    second = 0,
  },
  { disambiguation = 'earlier' } = {},
) {
  const tz = String(timeZone || '');
  if (!tz) throw new TypeError('timeZone_required');
  const want = { year, month, day, hour, minute, second };
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  let candidate = localAsUtc;
  for (let i = 0; i < 6; i += 1) {
    const offset = getTimeZoneOffsetMs(tz, candidate);
    const next = localAsUtc - offset;
    if (Math.abs(next - candidate) < 1) {
      candidate = next;
      break;
    }
    candidate = next;
  }

  const probes = [
    candidate,
    candidate - 3600_000,
    candidate + 3600_000,
    candidate - 2 * 3600_000,
    candidate + 2 * 3600_000,
  ];
  const matches = [];
  const seen = new Set();
  for (const ms of probes) {
    if (seen.has(ms)) continue;
    seen.add(ms);
    const parts = readZonedParts(new Date(ms), tz);
    if (sameWallClock(parts, want)) matches.push(ms);
  }

  matches.sort((a, b) => a - b);
  if (matches.length === 1) return new Date(matches[0]);
  if (matches.length >= 2) {
    const pick = disambiguation === 'later' ? matches[matches.length - 1] : matches[0];
    return new Date(pick);
  }

  const err = new RangeError('nonexistent_wall_time');
  err.code = 'nonexistent_wall_time';
  throw err;
}

export function nyWallClockToUtc({ date, time, disambiguation } = {}) {
  const d = parseIsoDate(date);
  const t = parseWallClockTime(time);
  if (!d) throw new TypeError('invalid_date');
  if (!t) throw new TypeError('invalid_time');
  return zonedWallClockToUtc(
    { timeZone: NY_TZ, ...d, ...t },
    { disambiguation: disambiguation ?? 'earlier' },
  );
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatIsoDate({ year, month, day }) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function nyZonedParts(date = new Date()) {
  return readZonedParts(date, NY_TZ);
}

export function nyCalendarDate(date = new Date()) {
  return formatIsoDate(readZonedParts(date, NY_TZ));
}

export function addDaysToIsoDate(value, days) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new TypeError('invalid_date');
  const n = Number(days);
  if (!Number.isInteger(n)) throw new TypeError('invalid_day_count');
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + n));
  return formatIsoDate({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekdayFromIsoDate(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new TypeError('invalid_date');
  const jsDay = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function listIsoDatesInclusive(start, end) {
  const startParsed = parseIsoDate(start);
  const endParsed = parseIsoDate(end);
  if (!startParsed || !endParsed) throw new TypeError('invalid_date');
  if (start > end) return [];
  const dates = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDaysToIsoDate(current, 1);
  }
  return dates;
}

export { NY_TZ, parseIsoDate, parseWallClockTime };

