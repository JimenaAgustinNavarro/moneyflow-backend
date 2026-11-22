import {
  assertValidGregorianDate,
  formatDate,
  formatDateTime,
  getLimaCurrentMonth,
  getLimaToday,
  isValidGregorianDate,
} from './lima-date.util';

describe('lima-date.util', () => {
  it('returns the correct America/Lima date during the 19:00-23:59 Lima window when UTC is already next day', () => {
    // 2026-11-21 23:30:00 America/Lima (UTC-5) === 2026-11-22 04:30:00Z
    const lateLimaNight = new Date('2026-11-22T04:30:00.000Z');
    expect(getLimaToday(lateLimaNight)).toBe('2026-11-21');
    expect(getLimaCurrentMonth(lateLimaNight)).toBe('2026-11');

    // Boundary at 2026-11-30 19:00:00 America/Lima (UTC-5) === 2026-12-01 00:00:00Z
    const monthEndLimaEvening = new Date('2026-12-01T00:00:00.000Z');
    expect(getLimaToday(monthEndLimaEvening)).toBe('2026-11-30');
    expect(getLimaCurrentMonth(monthEndLimaEvening)).toBe('2026-11');
  });

  it('rejects invalid Gregorian dates such as 2026-02-31 and non-leap 2026-02-29', () => {
    expect(isValidGregorianDate('2026-02-31')).toBe(false);
    expect(isValidGregorianDate('2026-02-29')).toBe(false);
    expect(isValidGregorianDate('2026-04-31')).toBe(false);
    expect(isValidGregorianDate('2026-13-01')).toBe(false);
    expect(isValidGregorianDate('2026-11-21')).toBe(true);
    expect(isValidGregorianDate('2024-02-29')).toBe(true);

    expect(() => assertValidGregorianDate('2026-02-31')).toThrow(
      'Invalid Gregorian calendar date: "2026-02-31"',
    );
  });

  it('formats business DATE without UTC day-shift and formats TIMESTAMPTZ in America/Lima', () => {
    expect(formatDate('2026-11-21')).toBe('21/11/2026');
    expect(formatDateTime('2026-11-22T04:30:15.000Z')).toContain('21/11/2026');
    expect(formatDateTime('2026-11-22T04:30:15.000Z')).toContain('23:30:15');
  });
});
