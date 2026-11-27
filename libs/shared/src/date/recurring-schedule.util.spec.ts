import {
  addDaysToIsoDate,
  diffIsoDays,
  extractDayOfMonth,
  generateOccurrenceDatesInWindow,
  getDaysInGregorianMonth,
} from './recurring-schedule.util';

describe('addDaysToIsoDate', () => {
  it('adds positive days', () => {
    expect(addDaysToIsoDate('2026-01-15', 10)).toBe('2026-01-25');
  });

  it('crosses month boundary', () => {
    expect(addDaysToIsoDate('2026-01-28', 7)).toBe('2026-02-04');
  });

  it('crosses year boundary', () => {
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('adds zero days returns same date', () => {
    expect(addDaysToIsoDate('2026-11-26', 0)).toBe('2026-11-26');
  });

  it('subtracts days with negative offset', () => {
    expect(addDaysToIsoDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles 60-day horizon', () => {
    expect(addDaysToIsoDate('2026-11-26', 60)).toBe('2027-01-25');
  });
});

describe('diffIsoDays', () => {
  it('computes positive difference', () => {
    expect(diffIsoDays('2026-01-01', '2026-01-11')).toBe(10);
  });

  it('computes zero for same date', () => {
    expect(diffIsoDays('2026-11-26', '2026-11-26')).toBe(0);
  });

  it('computes negative when from > to', () => {
    expect(diffIsoDays('2026-11-26', '2026-11-20')).toBe(-6);
  });
});

describe('getDaysInGregorianMonth', () => {
  it('returns 28 for February in non-leap year', () => {
    expect(getDaysInGregorianMonth(2026, 2)).toBe(28);
  });

  it('returns 29 for February in leap year 2024', () => {
    expect(getDaysInGregorianMonth(2024, 2)).toBe(29);
  });

  it('returns 29 for February in leap year 2028', () => {
    expect(getDaysInGregorianMonth(2028, 2)).toBe(29);
  });

  it('returns 31 for January', () => {
    expect(getDaysInGregorianMonth(2026, 1)).toBe(31);
  });

  it('returns 30 for April', () => {
    expect(getDaysInGregorianMonth(2026, 4)).toBe(30);
  });
});

describe('extractDayOfMonth', () => {
  it('extracts 31 from 2026-01-31', () => {
    expect(extractDayOfMonth('2026-01-31')).toBe(31);
  });

  it('extracts 29 from 2024-02-29', () => {
    expect(extractDayOfMonth('2024-02-29')).toBe(29);
  });

  it('extracts 1 from 2026-03-01', () => {
    expect(extractDayOfMonth('2026-03-01')).toBe(1);
  });
});

describe('generateOccurrenceDatesInWindow — WEEKLY', () => {
  it('generates weekly dates in window', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'WEEKLY',
      startDate: '2026-11-26',
      endDate: null,
      anchorDay: 26,
      windowStart: '2026-11-26',
      windowEnd: '2026-12-17',
    });
    expect(dates).toEqual(['2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17']);
  });

  it('O(1) jump: startDate far in the past yields no occurrences before windowStart', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'WEEKLY',
      startDate: '2020-01-01',
      endDate: null,
      anchorDay: 3,
      windowStart: '2026-11-26',
      windowEnd: '2026-12-10',
    });
    for (const d of dates) {
      expect(d >= '2026-11-26').toBe(true);
    }
    expect(dates.length).toBeGreaterThan(0);
  });

  it('respects endDate cut-off', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'WEEKLY',
      startDate: '2026-11-26',
      endDate: '2026-12-10',
      anchorDay: 26,
      windowStart: '2026-11-26',
      windowEnd: '2026-12-31',
    });
    expect(dates[dates.length - 1]).toBe('2026-12-10');
  });

  it('returns empty when startDate is after windowEnd', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'WEEKLY',
      startDate: '2027-01-01',
      endDate: null,
      anchorDay: 1,
      windowStart: '2026-11-26',
      windowEnd: '2026-12-25',
    });
    expect(dates).toEqual([]);
  });
});

describe('generateOccurrenceDatesInWindow — BIWEEKLY', () => {
  it('generates biweekly dates', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'BIWEEKLY',
      startDate: '2026-11-26',
      endDate: null,
      anchorDay: 26,
      windowStart: '2026-11-26',
      windowEnd: '2026-12-24',
    });
    expect(dates).toEqual(['2026-11-26', '2026-12-10', '2026-12-24']);
  });

  it('O(1) jump with old startDate', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'BIWEEKLY',
      startDate: '2020-01-01',
      endDate: null,
      anchorDay: 3,
      windowStart: '2026-11-26',
      windowEnd: '2026-12-10',
    });
    for (const d of dates) {
      expect(d >= '2026-11-26').toBe(true);
    }
    expect(dates.length).toBeGreaterThan(0);
  });
});

describe('generateOccurrenceDatesInWindow — MONTHLY anchorDay 31', () => {
  it('clamps anchorDay 31 to last day of month: Jan -> Feb -> Mar -> Apr -> May', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2026-01-31',
      endDate: null,
      anchorDay: 31,
      windowStart: '2026-01-31',
      windowEnd: '2026-05-31',
    });
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('clamps anchorDay 31 in leap year Feb to 29', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2028-01-31',
      endDate: null,
      anchorDay: 31,
      windowStart: '2028-01-31',
      windowEnd: '2028-05-31',
    });
    expect(dates).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']);
  });

  it('clamps anchorDay 30 for February', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2026-01-30',
      endDate: null,
      anchorDay: 30,
      windowStart: '2026-01-30',
      windowEnd: '2026-04-30',
    });
    expect(dates).toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']);
  });

  it('clamps anchorDay 29 for February in non-leap year', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2026-01-29',
      endDate: null,
      anchorDay: 29,
      windowStart: '2026-01-29',
      windowEnd: '2026-04-29',
    });
    expect(dates).toEqual(['2026-01-29', '2026-02-28', '2026-03-29', '2026-04-29']);
  });

  it('O(1) jump: startDate in 2020 produces first occurrence inside windowStart 2026-11-26', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2020-11-15',
      endDate: null,
      anchorDay: 15,
      windowStart: '2026-11-26',
      windowEnd: '2027-01-25',
    });
    for (const d of dates) {
      expect(d >= '2026-11-26').toBe(true);
    }
  });

  it('respects endDate with MONTHLY', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2026-11-01',
      endDate: '2027-01-01',
      anchorDay: 1,
      windowStart: '2026-11-01',
      windowEnd: '2027-06-01',
    });
    expect(dates[dates.length - 1]).toBe('2027-01-01');
  });
});

describe('generateOccurrenceDatesInWindow — YEARLY anchorDay 29 (leap origin)', () => {
  it('clamps Feb-29 to Feb-28 in non-leap years, restores Feb-29 in 2028', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'YEARLY',
      startDate: '2024-02-29',
      endDate: null,
      anchorDay: 29,
      windowStart: '2024-02-29',
      windowEnd: '2028-12-31',
    });
    expect(dates).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('YEARLY anchorDay 31 for Jan-31 origin', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'YEARLY',
      startDate: '2024-01-31',
      endDate: null,
      anchorDay: 31,
      windowStart: '2024-01-31',
      windowEnd: '2027-01-31',
    });
    expect(dates).toEqual(['2024-01-31', '2025-01-31', '2026-01-31', '2027-01-31']);
  });

  it('O(1) jump with YEARLY from 2020', () => {
    const dates = generateOccurrenceDatesInWindow({
      frequency: 'YEARLY',
      startDate: '2020-06-15',
      endDate: null,
      anchorDay: 15,
      windowStart: '2026-11-26',
      windowEnd: '2027-07-01',
    });
    expect(dates).toEqual(['2027-06-15']);
    for (const d of dates) {
      expect(d >= '2026-11-26').toBe(true);
    }
  });
});

describe('generateOccurrenceDatesInWindow — nocturnal Lima window', () => {
  it('windowStart 2026-11-26 from 22:30 Lima time (UTC 2026-11-27T03:30Z)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-27T03:30:00.000Z'));

    // Using getLimaToday() logic: should return 2026-11-26
    const { getLimaToday } =
      jest.requireActual<typeof import('./lima-date.util')>('./lima-date.util');
    const today = getLimaToday();
    expect(today).toBe('2026-11-26');

    const dates = generateOccurrenceDatesInWindow({
      frequency: 'MONTHLY',
      startDate: '2026-11-26',
      endDate: null,
      anchorDay: 26,
      windowStart: today,
      windowEnd: addDaysToIsoDate(today, 60),
    });
    expect(dates[0]).toBe('2026-11-26');
    expect(addDaysToIsoDate(today, 60)).toBe('2027-01-25');

    jest.useRealTimers();
  });
});
