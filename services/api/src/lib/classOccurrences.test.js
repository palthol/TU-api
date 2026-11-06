import { describe, expect, it } from 'vitest';
import { expandClassOccurrences } from './classOccurrences.js';

const MONDAY_CLASS = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Class 1',
  instructor: 'Alex',
  day_of_week: 1,
  recurrence: 'weekly',
  start_time: '19:00:00',
  duration_minutes: 60,
  capacity: 12,
  is_active: true,
};

describe('expandClassOccurrences', () => {
  it('lists weekly occurrences for the next 14 gym-local days and skips ended ones', () => {
    // Friday 2026-11-06 10:00 America/New_York = 15:00 UTC
    const now = new Date('2026-11-06T15:00:00.000Z');
    const { startDate, endDate, days, occurrences, timezone } = expandClassOccurrences(
      [MONDAY_CLASS, { ...MONDAY_CLASS, id: 'inactive', is_active: false, name: 'Hidden' }],
      { now },
    );

    expect(timezone).toBe('America/New_York');
    expect(startDate).toBe('2026-11-06');
    expect(endDate).toBe('2026-11-19');
    expect(days).toBe(14);
    expect(occurrences.map((row) => row.gym_date)).toEqual(['2026-11-09', '2026-11-16']);
    expect(occurrences[0]).toMatchObject({
      class_id: MONDAY_CLASS.id,
      name: 'Class 1',
      instructor: 'Alex',
      day_of_week: 1,
      start_time: '19:00:00',
      duration_minutes: 60,
      capacity: 12,
      starts_at: '2026-11-10T00:00:00.000Z',
      ends_at: '2026-11-10T01:00:00.000Z',
    });
    expect(occurrences.every((row) => row.name !== 'Hidden')).toBe(true);
  });

  it('keeps an in-progress class today and drops one that already ended', () => {
    const now = new Date('2026-11-10T00:30:00.000Z'); // Monday 19:30 NY during Class 1
    const morning = {
      ...MONDAY_CLASS,
      id: 'morning',
      name: 'Morning',
      start_time: '07:00:00',
      duration_minutes: 60,
    };
    const { occurrences } = expandClassOccurrences([MONDAY_CLASS, morning], { now });
    expect(occurrences.filter((row) => row.gym_date === '2026-11-09').map((row) => row.name)).toEqual([
      'Class 1',
    ]);
    expect(occurrences.filter((row) => row.name === 'Morning').map((row) => row.gym_date)).toEqual([
      '2026-11-16',
    ]);
  });

  it('uses the earlier fall-back instant on 2026-11-01', () => {
    const now = new Date('2026-11-01T04:00:00.000Z');
    const lateNight = {
      ...MONDAY_CLASS,
      day_of_week: 7,
      start_time: '01:30:00',
      duration_minutes: 30,
      name: 'Late',
    };
    const { occurrences } = expandClassOccurrences([lateNight], { now, windowDays: 1 });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].starts_at).toBe('2026-11-01T05:30:00.000Z');
  });

  it('skips the 2027-03-14 spring-forward missing hour', () => {
    const now = new Date('2027-03-14T07:00:00.000Z'); // Sunday 03:00 EDT, after the gap, before 03:30
    const missing = {
      ...MONDAY_CLASS,
      day_of_week: 7,
      start_time: '02:30:00',
      name: 'Ghost',
    };
    const real = {
      ...MONDAY_CLASS,
      day_of_week: 7,
      start_time: '03:30:00',
      name: 'Real',
    };
    const { occurrences } = expandClassOccurrences([missing, real], { now, windowDays: 1 });
    expect(occurrences.map((row) => row.name)).toEqual(['Real']);
    expect(occurrences[0].starts_at).toBe('2027-03-14T07:30:00.000Z');
  });
});
