import { InternalAuthContext } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const fundId = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa';
  const catIncomeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const catExpenseId1 = 'cccccccc-cccc-1ccc-8ccc-cccccccccccc';
  const catExpenseId2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const txId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const entryId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const splitId1 = '12121212-1212-4121-8121-121212121212';
  const splitId2 = '34343434-3434-4343-8343-343434343434';

  const contextA: InternalAuthContext = {
    requestId: 'req-ledger-1',
    userId: userA,
    timestamp: Date.now(),
    signature: 'sig',
  };

  const baseNow = new Date('2026-11-22T15:00:00.000Z');
  const limaDate = new Date('2026-11-22T00:00:00.000Z');

  let prismaMock: {
    fund: { findFirst: jest.Mock };
    category: { findMany: jest.Mock };
    fundEntry: { aggregate: jest.Mock; create: jest.Mock };
    financialTransaction: { findFirst: jest.Mock; create: jest.Mock };
    transactionSplit: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  let service: LedgerService;

  beforeEach(() => {
    prismaMock = {
      fund: { findFirst: jest.fn() },
      category: { findMany: jest.fn() },
      fundEntry: { aggregate: jest.fn(), create: jest.fn() },
      financialTransaction: { findFirst: jest.fn(), create: jest.fn() },
      transactionSplit: { create: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
    );

    service = new LedgerService(prismaMock as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records an INCOME transaction with FOR UPDATE lock and America/Lima date during 19:00-23:59 Lima', async () => {
    jest.useFakeTimers();
    // 2026-11-23T03:15:00.000Z === 2026-11-22 22:15:00 America/Lima (UTC-5)
    jest.setSystemTime(new Date('2026-11-23T03:15:00.000Z'));

    prismaMock.$queryRaw.mockResolvedValue([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValue({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.category.findMany.mockResolvedValue([
      { id: catIncomeId, kind: 'INCOME', isArchived: false },
    ]);
    prismaMock.fundEntry.aggregate.mockResolvedValue({
      _sum: { signedAmount: { toString: () => '100.00' } },
    });
    prismaMock.financialTransaction.create.mockResolvedValue({
      id: txId,
      type: 'INCOME',
      status: 'POSTED',
      amount: { toString: () => '250.50' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Honorarios',
      notes: null,
      categoryId: catIncomeId,
      relatedTransactionId: null,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create.mockResolvedValue({
      id: entryId,
      fundId,
      signedAmount: { toString: () => '250.50' },
      currency: 'PEN',
      occurredOn: limaDate,
      createdAt: baseNow,
    });

    const result = await service.recordTransaction(contextA, {
      type: 'INCOME',
      fundId,
      amount: '250.5',
      description: '  Honorarios  ',
      categoryId: catIncomeId,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const createdTxCall = prismaMock.financialTransaction.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createdTxCall[0].data).toMatchObject({
      userId: userA,
      type: 'INCOME',
      status: 'POSTED',
      amount: '250.50',
      currency: 'PEN',
      occurredOn: limaDate,
      description: 'Honorarios',
      categoryId: catIncomeId,
    });
    const createdEntryCall = prismaMock.fundEntry.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createdEntryCall[0].data).toMatchObject({
      signedAmount: '250.50',
      occurredOn: limaDate,
    });
    expect(result.fundBalanceAfter).toBe('350.50');
    expect(result.transaction.occurredOn).toBe('2026-11-22');
    expect(result.transaction.entries).toHaveLength(1);
    expect(result.transaction.splits).toEqual([]);
  });

  it('records an EXPENSE with splits using negated Decimal amount and updates fundBalanceAfter', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValue({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.category.findMany.mockResolvedValue([
      { id: catExpenseId1, kind: 'EXPENSE', isArchived: false },
      { id: catExpenseId2, kind: 'EXPENSE', isArchived: false },
    ]);
    prismaMock.fundEntry.aggregate.mockResolvedValue({
      _sum: { signedAmount: { toString: () => '500.00' } },
    });
    prismaMock.financialTransaction.create.mockResolvedValue({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '120.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Supermercado',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create.mockResolvedValue({
      id: entryId,
      fundId,
      signedAmount: { toString: () => '-120.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      createdAt: baseNow,
    });
    prismaMock.transactionSplit.create
      .mockResolvedValueOnce({
        id: splitId1,
        categoryId: catExpenseId1,
        amount: { toString: () => '80.00' },
        note: 'Alimentos',
        createdAt: baseNow,
      })
      .mockResolvedValueOnce({
        id: splitId2,
        categoryId: catExpenseId2,
        amount: { toString: () => '40.00' },
        note: null,
        createdAt: baseNow,
      });

    const result = await service.recordTransaction(contextA, {
      type: 'EXPENSE',
      fundId,
      amount: '120.00',
      occurredOn: '2026-11-22',
      description: 'Supermercado',
      splits: [
        { categoryId: catExpenseId1, amount: '80.00', note: 'Alimentos' },
        { categoryId: catExpenseId2, amount: '40.00' },
      ],
    });

    const splitEntryCall = prismaMock.fundEntry.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(splitEntryCall[0].data).toMatchObject({
      signedAmount: '-120.00',
    });
    expect(result.fundBalanceAfter).toBe('380.00');
    expect(result.transaction.categoryId).toBeNull();
    expect(result.transaction.splits).toHaveLength(2);
  });

  it('enforces allowNegativeBalance=false (409) vs allowNegativeBalance=true (allows negative)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: fundId }]);
    prismaMock.category.findMany.mockResolvedValue([
      { id: catExpenseId1, kind: 'EXPENSE', isArchived: false },
    ]);
    prismaMock.fundEntry.aggregate.mockResolvedValue({
      _sum: { signedAmount: { toString: () => '50.00' } },
    });

    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });

    await expect(
      service.recordTransaction(contextA, {
        type: 'EXPENSE',
        fundId,
        amount: '75.00',
        description: 'Sobregiro rechazado',
        categoryId: catExpenseId1,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: true,
      isArchived: false,
    });
    prismaMock.financialTransaction.create.mockResolvedValue({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '75.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Sobregiro permitido',
      notes: null,
      categoryId: catExpenseId1,
      relatedTransactionId: null,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create.mockResolvedValue({
      id: entryId,
      fundId,
      signedAmount: { toString: () => '-75.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      createdAt: baseNow,
    });

    const allowed = await service.recordTransaction(contextA, {
      type: 'EXPENSE',
      fundId,
      amount: '75.00',
      description: 'Sobregiro permitido',
      categoryId: catExpenseId1,
    });
    expect(allowed.fundBalanceAfter).toBe('-25.00');
  });

  it('blocks missing/cross-user/archived funds, missing/archived/wrong-kind categories, and >50 splits', async () => {
    const tooManySplits = Array.from({ length: 51 }, () => ({
      categoryId: catExpenseId1,
      amount: '1.00',
    }));
    await expect(
      service.recordTransaction(contextA, {
        type: 'EXPENSE',
        fundId,
        amount: '51.00',
        description: 'Excede 50 splits',
        splits: tooManySplits,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 400 } });

    // Missing or cross-user fund -> 404
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.recordTransaction(contextA, {
        type: 'INCOME',
        fundId,
        amount: '10.00',
        description: 'Test',
        categoryId: catIncomeId,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 404 } });

    // Archived fund -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: true,
    });
    await expect(
      service.recordTransaction(contextA, {
        type: 'INCOME',
        fundId,
        amount: '10.00',
        description: 'Test',
        categoryId: catIncomeId,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // Missing or cross-user category -> 404
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.category.findMany.mockResolvedValueOnce([]);
    await expect(
      service.recordTransaction(contextA, {
        type: 'INCOME',
        fundId,
        amount: '10.00',
        description: 'Test',
        categoryId: catIncomeId,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 404 } });

    // Archived category -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.category.findMany.mockResolvedValueOnce([
      { id: catIncomeId, kind: 'INCOME', isArchived: true },
    ]);
    await expect(
      service.recordTransaction(contextA, {
        type: 'INCOME',
        fundId,
        amount: '10.00',
        description: 'Test',
        categoryId: catIncomeId,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // Wrong category kind -> 400
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.category.findMany.mockResolvedValueOnce([
      { id: catExpenseId1, kind: 'EXPENSE', isArchived: false },
    ]);
    await expect(
      service.recordTransaction(contextA, {
        type: 'INCOME',
        fundId,
        amount: '10.00',
        description: 'Test',
        categoryId: catExpenseId1,
      }),
    ).rejects.toMatchObject({ error: { statusCode: 400 } });
  });

  it('handles idempotency canonically even when DB returns splits in reverse order, and rejects parameter mismatch with 409', async () => {
    const existingWithReverseSplits = {
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '120.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Supermercado',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: 'idem-splits-1',
      createdAt: baseNow,
      updatedAt: baseNow,
      fundEntries: [
        {
          id: entryId,
          fundId,
          signedAmount: { toString: () => '-120.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
      transactionSplits: [
        {
          id: splitId2,
          categoryId: catExpenseId2,
          amount: { toString: () => '40.00' },
          note: null,
          createdAt: baseNow,
        },
        {
          id: splitId1,
          categoryId: catExpenseId1,
          amount: { toString: () => '80.00' },
          note: 'Alimentos',
          createdAt: baseNow,
        },
      ],
    };

    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(existingWithReverseSplits);
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '380.00' } },
    });

    const retryResult = await service.recordTransaction(contextA, {
      type: 'EXPENSE',
      fundId,
      amount: '120.00',
      occurredOn: '2026-11-22',
      description: 'Supermercado',
      idempotencyKey: 'idem-splits-1',
      splits: [
        { categoryId: catExpenseId1, amount: '80.00', note: 'Alimentos' },
        { categoryId: catExpenseId2, amount: '40.00' },
      ],
    });

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.financialTransaction.create).not.toHaveBeenCalled();
    expect(retryResult.transaction.id).toBe(txId);
    expect(retryResult.fundBalanceAfter).toBe('380.00');

    // Different amount with same Idempotency-Key -> 409 Conflict
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(existingWithReverseSplits);
    await expect(
      service.recordTransaction(contextA, {
        type: 'EXPENSE',
        fundId,
        amount: '121.00',
        occurredOn: '2026-11-22',
        description: 'Supermercado',
        idempotencyKey: 'idem-splits-1',
        splits: [
          { categoryId: catExpenseId1, amount: '81.00', note: 'Alimentos' },
          { categoryId: catExpenseId2, amount: '40.00' },
        ],
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });
  });

  it('recovers from concurrent P2002 idempotency collision when equivalent, throws 409 on mismatch, and rethrows if winner is null', async () => {
    const payload = {
      type: 'INCOME' as const,
      fundId,
      amount: '200.00',
      occurredOn: '2026-11-22',
      description: 'Bono',
      categoryId: catIncomeId,
      idempotencyKey: 'idem-race-1',
    };

    const winnerTx = {
      id: txId,
      type: 'INCOME',
      status: 'POSTED',
      amount: { toString: () => '200.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Bono',
      notes: null,
      categoryId: catIncomeId,
      relatedTransactionId: null,
      idempotencyKey: 'idem-race-1',
      createdAt: baseNow,
      updatedAt: baseNow,
      fundEntries: [
        {
          id: entryId,
          fundId,
          signedAmount: { toString: () => '200.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
      transactionSplits: [],
    };

    // 1) Winner matches -> returns idempotent result
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(winnerTx);
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '200.00' } },
    });

    const recovered = await service.recordTransaction(contextA, payload);
    expect(recovered.transaction.id).toBe(txId);
    expect(recovered.fundBalanceAfter).toBe('200.00');

    // 2) Winner differs -> 409 Conflict
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(winnerTx);
    await expect(
      service.recordTransaction(contextA, { ...payload, amount: '300.00' }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // 3) Winner is null -> rethrows original P2002 error
    const rawP2002 = { code: 'P2002', message: 'unique constraint' };
    prismaMock.$transaction.mockRejectedValueOnce(rawP2002);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(null);
    await expect(service.recordTransaction(contextA, payload)).rejects.toBe(rawP2002);
  });

  it('returns TransactionDetailView in getById for owner and throws 404 for another user', async () => {
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'INCOME',
      status: 'POSTED',
      amount: { toString: () => '100.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Ingreso',
      notes: null,
      categoryId: catIncomeId,
      relatedTransactionId: null,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
      fundEntries: [
        {
          id: entryId,
          fundId,
          signedAmount: { toString: () => '100.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
      transactionSplits: [],
    });

    const detail = await service.getById(contextA, { id: txId });
    expect(detail.transaction.id).toBe(txId);
    expect(detail.transaction.entries).toHaveLength(1);

    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(null);
    await expect(service.getById(contextA, { id: txId })).rejects.toMatchObject({
      error: { statusCode: 404 },
    });
  });
});
