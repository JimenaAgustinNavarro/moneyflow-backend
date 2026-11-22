import Decimal from 'decimal.js';
import { addMoney, formatMoney, isValidMoneyString, parseMoney, subMoney } from './decimal.util';

describe('decimal.util', () => {
  it('rounds half up at 2 decimal places for boundary values', () => {
    expect(formatMoney('10.005')).toBe('10.01');
    expect(formatMoney('10.004')).toBe('10.00');
    expect(formatMoney('10.015')).toBe('10.02');
    expect(formatMoney('-10.005')).toBe('-10.01');
    expect(formatMoney('1250')).toBe('1250.00');
  });

  it('normalizes negative zero after rounding to "0.00"', () => {
    expect(formatMoney('-0.001')).toBe('0.00');
    expect(formatMoney('-0.004')).toBe('0.00');
    expect(formatMoney('-0.00')).toBe('0.00');
    expect(formatMoney('-0')).toBe('0.00');
    expect(formatMoney('0')).toBe('0.00');
  });

  it('performs exact addition and subtraction without floating-point drift', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.30');
    expect(subMoney('100.00', '0.01')).toBe('99.99');
    expect(subMoney('10.00', '10.00')).toBe('0.00');
    expect(formatMoney(new Decimal('1234.565'))).toBe('1234.57');
  });

  it('validates money strings and rejects invalid formats', () => {
    expect(isValidMoneyString('1250.50')).toBe(true);
    expect(isValidMoneyString('-45.00')).toBe(true);
    expect(isValidMoneyString('12.34.56')).toBe(false);
    expect(isValidMoneyString('abc')).toBe(false);
    expect(isValidMoneyString('')).toBe(false);

    expect(() => parseMoney('12.34.56')).toThrow('Invalid monetary string');
    expect(() => parseMoney('NaN')).toThrow('Invalid monetary string');
  });
});
