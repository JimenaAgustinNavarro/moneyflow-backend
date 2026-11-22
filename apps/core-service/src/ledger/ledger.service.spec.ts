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
    fund: { findFirst: jest.Mock; findMany: jest.Mock };
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
      fund: { findFirst: jest.fn(), findMany: jest.fn() },
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

  it('records a TRANSFER with deterministic FOR UPDATE lock, zero-sum entries, and America/Lima date during 19:00-23:59 Lima', async () => {
    jest.useFakeTimers();
    // 2026-11-23T02:45:00.000Z === 2026-11-22 21:45:00 America/Lima (UTC-5)
    jest.setSystemTime(new Date('2026-11-23T02:45:00.000Z'));

    const sourceFundId = 'ffffffff-1111-4111-8111-111111111111';
    const destFundId = '11111111-2222-4222-8222-222222222222';
    const destEntryId = '99999999-9999-4999-8999-999999999999';

    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: destFundId }, { id: sourceFundId }]);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: sourceFundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
      {
        id: destFundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
    ]);
    prismaMock.fundEntry.aggregate
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '500.00' } } })
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '200.00' } } });
    prismaMock.financialTransaction.create.mockResolvedValueOnce({
      id: txId,
      type: 'TRANSFER',
      status: 'POSTED',
      amount: { toString: () => '150.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Traspaso a ahorros',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create
      .mockResolvedValueOnce({
        id: entryId,
        fundId: sourceFundId,
        signedAmount: { toString: () => '-150.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      })
      .mockResolvedValueOnce({
        id: destEntryId,
        fundId: destFundId,
        signedAmount: { toString: () => '150.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });

    const result = await service.recordTransfer(contextA, {
      sourceFundId: sourceFundId.toUpperCase(),
      destinationFundId: destFundId.toUpperCase(),
      amount: '150',
      description: '  Traspaso a ahorros  ',
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const rawCallArgs = prismaMock.$queryRaw.mock.calls[0] as unknown[];
    const rawValues = rawCallArgs.slice(1);
    expect(rawValues.slice(0, 2)).toEqual([destFundId, sourceFundId]);
    expect(result.sourceFundBalanceAfter).toBe('350.00');
    expect(result.destinationFundBalanceAfter).toBe('350.00');
    expect(result.transaction.occurredOn).toBe('2026-11-22');
    expect(result.transaction.entries[0]).toMatchObject({
      fundId: sourceFundId,
      signedAmount: '-150.00',
      occurredOn: '2026-11-22',
    });
    expect(result.transaction.entries[1]).toMatchObject({
      fundId: destFundId,
      signedAmount: '150.00',
      occurredOn: '2026-11-22',
    });
  });

  it('rejects invalid TRANSFER cases (same fund, missing/cross-user fund, archived fund, currency mismatch, insufficient balance) and allows overdraft when allowNegativeBalance=true', async () => {
    const destFundId = '22222222-3333-4333-8333-333333333333';

    await expect(
      service.recordTransfer(contextA, {
        sourceFundId: fundId,
        destinationFundId: fundId.toUpperCase(),
        amount: '10.00',
        description: 'Mismo fondo',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 400 } });

    // Missing or cross-user fund (only 1 row locked) -> 404
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    await expect(
      service.recordTransfer(contextA, {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '10.00',
        description: 'Fondo ajeno',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 404 } });

    // Archived destination fund -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }, { id: destFundId }]);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: fundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
      {
        id: destFundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: true,
      },
    ]);
    await expect(
      service.recordTransfer(contextA, {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '10.00',
        description: 'Destino archivado',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // Different currencies -> 400
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }, { id: destFundId }]);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: fundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
      {
        id: destFundId,
        userId: userA,
        currency: 'USD',
        allowNegativeBalance: false,
        isArchived: false,
      },
    ]);
    await expect(
      service.recordTransfer(contextA, {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '10.00',
        description: 'Moneda distinta',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 400 } });

    // Insufficient balance with allowNegativeBalance=false -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }, { id: destFundId }]);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: fundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
      {
        id: destFundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
    ]);
    prismaMock.fundEntry.aggregate
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '20.00' } } })
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '100.00' } } });
    await expect(
      service.recordTransfer(contextA, {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '50.00',
        description: 'Saldo insuficiente',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // Allowed overdraft when allowNegativeBalance=true
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }, { id: destFundId }]);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: fundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: true,
        isArchived: false,
      },
      {
        id: destFundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
    ]);
    prismaMock.fundEntry.aggregate
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '20.00' } } })
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '100.00' } } });
    prismaMock.financialTransaction.create.mockResolvedValueOnce({
      id: txId,
      type: 'TRANSFER',
      status: 'POSTED',
      amount: { toString: () => '50.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Sobregiro permitido',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create
      .mockResolvedValueOnce({
        id: entryId,
        fundId,
        signedAmount: { toString: () => '-50.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      })
      .mockResolvedValueOnce({
        id: '88888888-8888-4888-8888-888888888888',
        fundId: destFundId,
        signedAmount: { toString: () => '50.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });

    const overdraft = await service.recordTransfer(contextA, {
      sourceFundId: fundId,
      destinationFundId: destFundId,
      amount: '50.00',
      occurredOn: '2026-11-22',
      description: 'Sobregiro permitido',
    });
    expect(overdraft.sourceFundBalanceAfter).toBe('-30.00');
    expect(overdraft.destinationFundBalanceAfter).toBe('150.00');
  });

  it('orders TRANSFER entries deterministically (negative first, positive second) in getById and idempotent retry, rejects cross-type Idempotency-Key, and recovers from P2002', async () => {
    const destFundId = '22222222-3333-4333-8333-333333333333';
    const reversedTransferTx = {
      id: txId,
      type: 'TRANSFER',
      status: 'POSTED',
      amount: { toString: () => '150.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Traspaso',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: 'idem-transfer-1',
      createdAt: baseNow,
      updatedAt: baseNow,
      fundEntries: [
        {
          id: '22222222-0000-4000-8000-000000000002',
          fundId: destFundId,
          signedAmount: { toString: () => '150.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
        {
          id: '11111111-0000-4000-8000-000000000001',
          fundId,
          signedAmount: { toString: () => '-150.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
      transactionSplits: [],
    };

    // 1) getById returns negative entry first and positive entry second
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(reversedTransferTx);
    const detail = await service.getById(contextA, { id: txId });
    expect(detail.transaction.entries.map((e) => e.signedAmount)).toEqual(['-150.00', '150.00']);

    // 2) Idempotent retry with reversed DB entries succeeds and returns negative entry first
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(reversedTransferTx);
    prismaMock.fundEntry.aggregate
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '350.00' } } })
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '350.00' } } });

    const retry = await service.recordTransfer(contextA, {
      sourceFundId: fundId,
      destinationFundId: destFundId,
      amount: '150.00',
      occurredOn: '2026-11-22',
      description: 'Traspaso',
      idempotencyKey: 'idem-transfer-1',
    });
    expect(retry.transaction.entries.map((e) => e.signedAmount)).toEqual(['-150.00', '150.00']);
    expect(retry.sourceFundBalanceAfter).toBe('350.00');
    expect(retry.destinationFundBalanceAfter).toBe('350.00');

    // 3) Reusing Idempotency-Key of a prior INCOME on recordTransfer -> 409 Conflict
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      ...reversedTransferTx,
      type: 'INCOME',
      categoryId: catIncomeId,
      fundEntries: [
        {
          id: entryId,
          fundId,
          signedAmount: { toString: () => '150.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
    });
    await expect(
      service.recordTransfer(contextA, {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '150.00',
        occurredOn: '2026-11-22',
        description: 'Traspaso',
        idempotencyKey: 'idem-transfer-1',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // 4) Concurrent P2002 recovery on recordTransfer
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(reversedTransferTx);
    prismaMock.fundEntry.aggregate
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '350.00' } } })
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '350.00' } } });
    const recovered = await service.recordTransfer(contextA, {
      sourceFundId: fundId,
      destinationFundId: destFundId,
      amount: '150.00',
      occurredOn: '2026-11-22',
      description: 'Traspaso',
      idempotencyKey: 'idem-transfer-1',
    });
    expect(recovered.transaction.id).toBe(txId);
  });

  it('records ADJUSTMENT (INCREASE/DECREASE), enforces allowNegativeBalance and archived/missing fund checks, and validates direction idempotency', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '100.00' } },
    });
    prismaMock.financialTransaction.create.mockResolvedValueOnce({
      id: txId,
      type: 'ADJUSTMENT',
      status: 'POSTED',
      amount: { toString: () => '45.25' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Arqueo de caja',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: 'idem-adj-1',
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create.mockResolvedValueOnce({
      id: entryId,
      fundId,
      signedAmount: { toString: () => '45.25' },
      currency: 'PEN',
      occurredOn: limaDate,
      createdAt: baseNow,
    });

    const inc = await service.recordAdjustment(contextA, {
      fundId,
      direction: 'INCREASE',
      amount: '45.25',
      occurredOn: '2026-11-22',
      description: 'Arqueo de caja',
      idempotencyKey: 'idem-adj-1',
    });
    expect(inc.fundBalanceAfter).toBe('145.25');
    expect(inc.transaction.entries[0].signedAmount).toBe('45.25');

    // DECREASE exceeding balance when allowNegativeBalance=false -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      allowNegativeBalance: false,
      isArchived: false,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '30.00' } },
    });
    await expect(
      service.recordAdjustment(contextA, {
        fundId,
        direction: 'DECREASE',
        amount: '50.00',
        description: 'Faltante',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // Reusing Idempotency-Key with opposite direction -> 409 Conflict
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'ADJUSTMENT',
      status: 'POSTED',
      amount: { toString: () => '45.25' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Arqueo de caja',
      notes: null,
      categoryId: null,
      relatedTransactionId: null,
      idempotencyKey: 'idem-adj-1',
      createdAt: baseNow,
      updatedAt: baseNow,
      fundEntries: [
        {
          id: entryId,
          fundId,
          signedAmount: { toString: () => '45.25' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
      transactionSplits: [],
    });
    await expect(
      service.recordAdjustment(contextA, {
        fundId,
        direction: 'DECREASE',
        amount: '45.25',
        occurredOn: '2026-11-22',
        description: 'Arqueo de caja',
        idempotencyKey: 'idem-adj-1',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });
  });
});
