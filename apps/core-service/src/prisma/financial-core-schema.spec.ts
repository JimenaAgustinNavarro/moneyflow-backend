import {
  CategoryKind,
  CurrencyCode,
  FundType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/client';

describe('Financial Core Prisma 7 Schema Contract (MF-011)', () => {
  it('exports the expected financial enums matching PostgreSQL enum values', () => {
    expect(Object.values(CurrencyCode)).toEqual(['PEN', 'USD']);
    expect(Object.values(FundType)).toEqual(['CASH', 'BANK', 'WALLET', 'SAVINGS', 'OTHER']);
    expect(Object.values(CategoryKind)).toEqual(['INCOME', 'EXPENSE']);
    expect(Object.values(TransactionType)).toEqual([
      'INCOME',
      'EXPENSE',
      'TRANSFER',
      'ADJUSTMENT',
      'VOID',
      'REFUND',
    ]);
    expect(Object.values(TransactionStatus)).toEqual(['POSTED', 'VOIDED']);
  });

  it('enforces derived-balance invariant on Fund (no mutable balance column)', () => {
    const fundFields = Object.keys(Prisma.FundScalarFieldEnum);
    expect(fundFields).toEqual([
      'id',
      'userId',
      'name',
      'type',
      'currency',
      'color',
      'icon',
      'allowNegativeBalance',
      'isArchived',
      'createdAt',
      'updatedAt',
    ]);
    expect(fundFields).not.toContain('balance');
    expect(fundFields).not.toContain('currentBalance');
  });

  it('enforces America/Lima business date vs UTC technical timestamp duality', () => {
    const txFields = Object.keys(Prisma.FinancialTransactionScalarFieldEnum);
    expect(txFields).toContain('occurredOn');
    expect(txFields).toContain('recordedAt');
    expect(txFields).toContain('idempotencyKey');
    expect(txFields).toContain('relatedTransactionId');

    const entryFields = Object.keys(Prisma.FundEntryScalarFieldEnum);
    expect(entryFields).toEqual([
      'id',
      'userId',
      'transactionId',
      'fundId',
      'signedAmount',
      'currency',
      'occurredOn',
      'createdAt',
    ]);
  });

  it('exposes Category and TransactionSplit scalar fields with Prisma.Decimal precision support', () => {
    expect(Object.keys(Prisma.CategoryScalarFieldEnum)).toEqual([
      'id',
      'userId',
      'name',
      'kind',
      'color',
      'icon',
      'isSystem',
      'isArchived',
      'createdAt',
      'updatedAt',
    ]);
    expect(Object.keys(Prisma.TransactionSplitScalarFieldEnum)).toEqual([
      'id',
      'userId',
      'transactionId',
      'categoryId',
      'amount',
      'note',
      'createdAt',
    ]);

    const exactAmount = new Prisma.Decimal('1250.50');
    expect(exactAmount.toFixed(2)).toBe('1250.50');
  });
});
