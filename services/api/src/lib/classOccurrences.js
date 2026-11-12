import {
  NY_TZ,
  addDaysToIsoDate,
  isoWeekdayFromIsoDate,
  listIsoDatesInclusive,
  nyCalendarDate,
  nyWallClockToUtc,
} from './gymTime.js';

export const CLASS_OCCURRENCE_WINDOW_DAYS = 14;
export const MAX_PUBLIC_OCCURRENCES = 500;

function normalizeStartTime(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

/**
 * Expand active weekly classes into gym-local occurrences for the next N
 * calendar days in America/New_York. Skips already-ended occurrences and
 * spring-forward nonexistent wall times. Fall-back repeats use the earlier
 * (DST) instant.
 *
 * @param {Array<Record<string, unknown>>} classes
 * @param {{ now?: Date, windowDays?: number }} [options]
 */
export function expandClassOccurrences(classes, { now = new Date(), windowDays = CLASS_OCCURRENCE_WINDOW_DAYS } = {}) {
  const days = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : CLASS_OCCURRENCE_WINDOW_DAYS;
  const startDate = nyCalendarDate(now);
  const endDate = addDaysToIsoDate(startDate, days - 1);
  const dates = listIsoDatesInclusive(startDate, endDate);
  const nowMs = now.getTime();
  const occurrences = [];

  for (const klass of Array.isArray(classes) ? classes : []) {
    if (!klass || klass.is_active === false) continue;
    const dayOfWeek = Number(klass.day_of_week);
    const durationMinutes = Number(klass.duration_minutes);
    const startTime = normalizeStartTime(klass.start_time);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) continue;
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) continue;
    if (!startTime) continue;

    for (const gymDate of dates) {
      if (isoWeekdayFromIsoDate(gymDate) !== dayOfWeek) continue;
      let startsAt;
      try {
        startsAt = nyWallClockToUtc({ date: gymDate, time: startTime, disambiguation: 'earlier' });
      } catch (error) {
        if (error?.code === 'nonexistent_wall_time') continue;
        throw error;
      }
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      if (endsAt.getTime() <= nowMs) continue;
      occurrences.push({
        class_id: klass.id,
        name: klass.name,
        instructor: klass.instructor,
        day_of_week: dayOfWeek,
        recurrence: klass.recurrence || 'weekly',
        start_time: startTime,
        duration_minutes: durationMinutes,
        capacity: klass.capacity,
        gym_date: gymDate,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      if (occurrences.length >= MAX_PUBLIC_OCCURRENCES) break;
    }
    if (occurrences.length >= MAX_PUBLIC_OCCURRENCES) break;
  }

  occurrences.sort((a, b) => {
    const startCmp = a.starts_at.localeCompare(b.starts_at);
    if (startCmp !== 0) return startCmp;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return {
    timezone: NY_TZ,
    startDate,
    endDate,
    days,
    occurrences,
  };
}
