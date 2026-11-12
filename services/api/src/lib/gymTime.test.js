import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  isoWeekdayFromIsoDate,
  listIsoDatesInclusive,
  nyCalendarDate,
  nyWallClockToUtc,
} from './gymTime.js';

describe('gymTime (America/New_York)', () => {
  it('converts the 2026-11-01 fall-back repeated hour using disambiguation', () => {
    expect(
      nyWallClockToUtc({ date: '2026-11-01', time: '01:30:00', disambiguation: 'earlier' }).toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      nyWallClockToUtc({ date: '2026-11-01', time: '01:30:00', disambiguation: 'later' }).toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
  });

  it('rejects the 2027-03-14 spring-forward missing hour', () => {
    expect(() => nyWallClockToUtc({ date: '2027-03-14', time: '02:30:00' })).toThrow(/nonexistent/i);
  });

  it('converts wall times around the 2027-03-14 spring-forward boundary', () => {
    expect(nyWallClockToUtc({ date: '2027-03-14', time: '01:30:00' }).toISOString()).toBe(
      '2027-03-14T06:30:00.000Z',
    );
    expect(nyWallClockToUtc({ date: '2027-03-14', time: '03:30:00' }).toISOString()).toBe(
      '2027-03-14T07:30:00.000Z',
    );
  });

  it('reads the gym calendar date in America/New_York', () => {
    expect(nyCalendarDate(new Date('2026-11-06T15:00:00.000Z'))).toBe('2026-11-06');
    expect(nyCalendarDate(new Date('2026-11-07T03:30:00.000Z'))).toBe('2026-11-06');
    expect(nyCalendarDate(new Date('2026-11-07T05:00:00.000Z'))).toBe('2026-11-07');
  });

  it('adds calendar days and lists inclusive ISO dates', () => {
    expect(addDaysToIsoDate('2026-11-06', 13)).toBe('2026-11-19');
    expect(isoWeekdayFromIsoDate('2026-11-06')).toBe(5);
    expect(isoWeekdayFromIsoDate('2026-11-08')).toBe(7);
    expect(isoWeekdayFromIsoDate('2026-11-09')).toBe(1);
    expect(listIsoDatesInclusive('2026-11-06', '2026-11-08')).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });
});

