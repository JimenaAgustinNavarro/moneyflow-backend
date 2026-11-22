import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | Decimal;

const MONEY_STRING_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Validates that a string represents a valid finite decimal number.
 */
export function isValidMoneyString(value: string): boolean {
  return MONEY_STRING_REGEX.test(value.trim());
}

/**
 * Parses a strict monetary input (string or Decimal) into a Decimal instance.
 * Rejects JavaScript numbers at compile time and runtime to prevent floating-point drift.
 */
export function parseMoney(value: MoneyInput): Decimal {
  if (typeof value === 'number') {
    throw new Error('Numeric primitives are forbidden for monetary amounts; use string or Decimal');
  }

  if (value instanceof Decimal) {
    if (!value.isFinite()) {
      throw new Error('Monetary Decimal value must be finite');
    }
    return value;
  }

  const trimmed = value.trim();
  if (!isValidMoneyString(trimmed)) {
    throw new Error(`Invalid monetary string: "${value}"`);
  }

  return new Decimal(trimmed);
}

/**
 * Rounds a monetary value to 2 decimal places using ROUND_HALF_UP and normalizes -0 to 0.
 */
export function roundMoney(value: MoneyInput): Decimal {
  const rounded = parseMoney(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? new Decimal(0) : rounded;
}

/**
 * Formats a monetary value as an exact 2-decimal string ("0.00") using ROUND_HALF_UP.
 * Normalizes any zero result (including "-0.001") to "0.00".
 */
export function formatMoney(value: MoneyInput): string {
  const rounded = roundMoney(value);
  if (rounded.isZero()) {
    return '0.00';
  }
  return rounded.toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * Adds two monetary values with exact decimal arithmetic and returns a formatted "0.00" string.
 */
export function addMoney(left: MoneyInput, right: MoneyInput): string {
  return formatMoney(parseMoney(left).plus(parseMoney(right)));
}

/**
 * Subtracts two monetary values with exact decimal arithmetic and returns a formatted "0.00" string.
 */
export function subMoney(left: MoneyInput, right: MoneyInput): string {
  return formatMoney(parseMoney(left).minus(parseMoney(right)));
}
