export const LIMA_TIMEZONE = 'America/Lima';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function extractLimaDateParts(instant: Date): { year: string; month: string; day: string } {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('Invalid Date instant');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LIMA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to extract America/Lima date parts');
  }

  return { year, month, day };
}

/**
 * Returns the current calendar date in America/Lima as "YYYY-MM-DD".
 */
export function getLimaToday(now: Date = new Date()): string {
  const { year, month, day } = extractLimaDateParts(now);
  return `${year}-${month}-${day}`;
}

/**
 * Returns the current calendar month in America/Lima as "YYYY-MM".
 */
export function getLimaCurrentMonth(now: Date = new Date()): string {
  return getLimaToday(now).slice(0, 7);
}

/**
 * Validates that a string is a real Gregorian calendar date in "YYYY-MM-DD" format.
 */
export function isValidGregorianDate(dateStr: string): boolean {
  const match = ISO_DATE_REGEX.exec(dateStr);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

/**
 * Asserts that a string is a valid Gregorian date ("YYYY-MM-DD") and returns it.
 */
export function assertValidGregorianDate(dateStr: string): string {
  if (!isValidGregorianDate(dateStr)) {
    throw new Error(`Invalid Gregorian calendar date: "${dateStr}"`);
  }
  return dateStr;
}

/**
 * Formats a business calendar date ("YYYY-MM-DD") for display in America/Lima without UTC day-shift.
 */
export function formatDate(dateStr: string, locale = 'es-PE'): string {
  assertValidGregorianDate(dateStr);
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const noonUtc = new Date(
    Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 12, 0, 0),
  );

  return new Intl.DateTimeFormat(locale, {
    timeZone: LIMA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(noonUtc);
}

/**
 * Formats a technical timestamp (Date or ISO string) in America/Lima with date and time.
 */
export function formatDateTime(instant: Date | string, locale = 'es-PE'): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid timestamp provided to formatDateTime');
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: LIMA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
