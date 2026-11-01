import { describe, expect, it } from 'vitest';
import { nyWallClockToUtc } from './gymTime.js';

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
});

