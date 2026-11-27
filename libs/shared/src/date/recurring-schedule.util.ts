import { RecurringFrequencyValue } from '../contracts/planning.contract';
import { assertValidGregorianDate } from './lima-date.util';

export const RECURRING_HORIZON_DAYS = 60;

const MS_PER_DAY = 86_400_000;

function parseIsoDateParts(dateStr: string): { year: number; month: number; day: number } {
  assertValidGregorianDate(dateStr);
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };
}

function formatIsoDateParts(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toUtcMidnightMs(dateStr: string): number {
  const { year, month, day } = parseIsoDateParts(dateStr);
  return Date.UTC(year, month - 1, day);
}

/**
 * Adds a signed integer number of calendar days to a Gregorian YYYY-MM-DD date.
 */
export function addDaysToIsoDate(dateStr: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(`Days offset must be an integer: ${days}`);
  }

  const baseMs = toUtcMidnightMs(dateStr);
  const shifted = new Date(baseMs + days * MS_PER_DAY);
  return formatIsoDateParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Computes exact calendar day difference (toDateStr - fromDateStr).
 */
export function diffIsoDays(fromDateStr: string, toDateStr: string): number {
  const fromMs = toUtcMidnightMs(fromDateStr);
  const toMs = toUtcMidnightMs(toDateStr);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/**
 * Returns the number of days in a Gregorian month (month is 1-12).
 */
export function getDaysInGregorianMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid year/month: ${year}-${month}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Extracts the day of month (1..31) from a valid Gregorian YYYY-MM-DD date.
 */
export function extractDayOfMonth(dateStr: string): number {
  return parseIsoDateParts(dateStr).day;
}

function buildClampedMonthDate(
  year: number,
  monthIndexZeroBased: number,
  anchorDay: number,
): string {
  const normalizedYear = year + Math.floor(monthIndexZeroBased / 12);
  const normalizedMonthIndex = ((monthIndexZeroBased % 12) + 12) % 12;
  const month = normalizedMonthIndex + 1;
  const maxDay = getDaysInGregorianMonth(normalizedYear, month);
  const clampedDay = Math.min(anchorDay, maxDay);
  return formatIsoDateParts(normalizedYear, month, clampedDay);
}

export interface GenerateOccurrenceDatesParams {
  frequency: RecurringFrequencyValue;
  startDate: string;
  endDate: string | null;
  anchorDay: number;
  windowStart: string;
  windowEnd: string;
}

/**
 * Generates sorted YYYY-MM-DD occurrence dates within [windowStart, windowEnd]
 * using O(1) initial jump from startDate and anchorDay clamping for MONTHLY/YEARLY.
 */
export function generateOccurrenceDatesInWindow(params: GenerateOccurrenceDatesParams): string[] {
  const { frequency, startDate, endDate, anchorDay, windowStart, windowEnd } = params;

  assertValidGregorianDate(startDate);
  assertValidGregorianDate(windowStart);
  assertValidGregorianDate(windowEnd);
  if (endDate !== null) {
    assertValidGregorianDate(endDate);
  }

  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new Error(`Invalid anchorDay: ${anchorDay}`);
  }

  if (endDate !== null && endDate < startDate) {
    return [];
  }

  const effectiveStart = startDate > windowStart ? startDate : windowStart;
  const effectiveEnd = endDate !== null && endDate < windowEnd ? endDate : windowEnd;

  if (effectiveStart > effectiveEnd) {
    return [];
  }

  const results: string[] = [];

  if (frequency === 'WEEKLY' || frequency === 'BIWEEKLY') {
    const stepDays = frequency === 'WEEKLY' ? 7 : 14;
    const daysSinceStart = diffIsoDays(startDate, effectiveStart);
    const initialSteps = daysSinceStart <= 0 ? 0 : Math.ceil(daysSinceStart / stepDays);
    let current = addDaysToIsoDate(startDate, initialSteps * stepDays);

    while (current <= effectiveEnd) {
      results.push(current);
      current = addDaysToIsoDate(current, stepDays);
    }

    return results;
  }

  const startParts = parseIsoDateParts(startDate);
  const effectiveStartParts = parseIsoDateParts(effectiveStart);

  if (frequency === 'MONTHLY') {
    let monthOffset =
      (effectiveStartParts.year - startParts.year) * 12 +
      (effectiveStartParts.month - startParts.month);
    if (monthOffset < 0) {
      monthOffset = 0;
    }

    const baseMonthIndex = startParts.month - 1;
    let current = buildClampedMonthDate(startParts.year, baseMonthIndex + monthOffset, anchorDay);
    if (current < effectiveStart) {
      monthOffset += 1;
      current = buildClampedMonthDate(startParts.year, baseMonthIndex + monthOffset, anchorDay);
    }

    while (current <= effectiveEnd) {
      results.push(current);
      monthOffset += 1;
      current = buildClampedMonthDate(startParts.year, baseMonthIndex + monthOffset, anchorDay);
    }

    return results;
  }

  // YEARLY
  let yearOffset = effectiveStartParts.year - startParts.year;
  if (yearOffset < 0) {
    yearOffset = 0;
  }

  const baseMonthIndex = startParts.month - 1;
  let current = buildClampedMonthDate(startParts.year + yearOffset, baseMonthIndex, anchorDay);
  if (current < effectiveStart) {
    yearOffset += 1;
    current = buildClampedMonthDate(startParts.year + yearOffset, baseMonthIndex, anchorDay);
  }

  while (current <= effectiveEnd) {
    results.push(current);
    yearOffset += 1;
    current = buildClampedMonthDate(startParts.year + yearOffset, baseMonthIndex, anchorDay);
  }

  return results;
}
