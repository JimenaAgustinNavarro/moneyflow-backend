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
    financialTransaction: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
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
      financialTransaction: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
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

  it('voids an EXPENSE and a TRANSFER with deterministic FOR UPDATE lock, ordered entries/affectedFundBalances, and default reason', async () => {
    const destFundId = '11111111-2222-4222-8222-222222222222';
    const voidTxId = '77777777-7777-4777-8777-777777777777';

    // 1) Void EXPENSE with default reason
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: txId }])
      .mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '120.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Supermercado',
      notes: null,
      categoryId: catExpenseId1,
      relatedTransactionId: null,
      idempotencyKey: null,
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
    });
    prismaMock.financialTransaction.count.mockResolvedValueOnce(0);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: fundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
    ]);
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '380.00' } },
    });
    prismaMock.financialTransaction.update.mockResolvedValueOnce({ id: txId, status: 'VOIDED' });
    prismaMock.financialTransaction.create.mockResolvedValueOnce({
      id: voidTxId,
      type: 'VOID',
      status: 'POSTED',
      amount: { toString: () => '120.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Anulación: Supermercado',
      notes: null,
      categoryId: catExpenseId1,
      relatedTransactionId: txId,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create.mockResolvedValueOnce({
      id: '88888888-1111-4111-8111-111111111111',
      fundId,
      signedAmount: { toString: () => '120.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      createdAt: baseNow,
    });

    const voidedExpense = await service.voidTransaction(contextA, {
      id: txId.toUpperCase(),
      occurredOn: '2026-11-22',
    });

    expect(voidedExpense.originalStatus).toBe('VOIDED');
    expect(voidedExpense.voidTransaction.description).toBe('Anulación: Supermercado');
    expect(voidedExpense.voidTransaction.entries[0].signedAmount).toBe('120.00');
    expect(voidedExpense.affectedFundBalances).toEqual([{ fundId, balanceAfter: '500.00' }]);

    // 2) Void TRANSFER: locks funds sorted ascending, orders VOID entries negative-first and affectedFundBalances by fundId asc
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: txId }])
      .mockResolvedValueOnce([{ id: destFundId }, { id: fundId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
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
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
      fundEntries: [
        {
          id: entryId,
          fundId,
          signedAmount: { toString: () => '-150.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          fundId: destFundId,
          signedAmount: { toString: () => '150.00' },
          currency: 'PEN',
          occurredOn: limaDate,
          createdAt: baseNow,
        },
      ],
    });
    prismaMock.financialTransaction.count.mockResolvedValueOnce(0);
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
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '200.00' } } })
      .mockResolvedValueOnce({ _sum: { signedAmount: { toString: () => '350.00' } } });
    prismaMock.financialTransaction.update.mockResolvedValueOnce({ id: txId, status: 'VOIDED' });
    prismaMock.financialTransaction.create.mockResolvedValueOnce({
      id: voidTxId,
      type: 'VOID',
      status: 'POSTED',
      amount: { toString: () => '150.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Reversa traspaso',
      notes: null,
      categoryId: null,
      relatedTransactionId: txId,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create
      .mockResolvedValueOnce({
        id: '88888888-2222-4222-8222-222222222222',
        fundId,
        signedAmount: { toString: () => '150.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      })
      .mockResolvedValueOnce({
        id: '88888888-3333-4333-8333-333333333333',
        fundId: destFundId,
        signedAmount: { toString: () => '-150.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });

    const voidedTransfer = await service.voidTransaction(contextA, {
      id: txId,
      reason: 'Reversa traspaso',
      occurredOn: '2026-11-22',
    });

    expect(voidedTransfer.voidTransaction.entries.map((e) => e.signedAmount)).toEqual([
      '-150.00',
      '150.00',
    ]);
    expect(voidedTransfer.affectedFundBalances).toEqual([
      { fundId: destFundId, balanceAfter: '50.00' },
      { fundId, balanceAfter: '500.00' },
    ]);
  });

  it('rejects invalid VOID cases (missing/cross-user, VOID/REFUND target, already VOIDED, earlier date, has refunds, archived fund, overdraft, P2002, idempotency mismatch)', async () => {
    // 1) Missing or cross-user -> 404
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.voidTransaction(contextA, { id: txId })).rejects.toMatchObject({
      error: { statusCode: 404 },
    });

    // 2) Target is VOID or REFUND -> 400
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'REFUND',
      status: 'POSTED',
      occurredOn: limaDate,
      fundEntries: [],
    });
    await expect(service.voidTransaction(contextA, { id: txId })).rejects.toMatchObject({
      error: { statusCode: 400 },
    });

    // 3) Already VOIDED -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'VOIDED',
      occurredOn: limaDate,
      fundEntries: [],
    });
    await expect(service.voidTransaction(contextA, { id: txId })).rejects.toMatchObject({
      error: { statusCode: 409 },
    });

    // 4) Chronological coherence: occurredOn earlier than original -> 400
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      occurredOn: limaDate,
      fundEntries: [
        { id: entryId, fundId, signedAmount: { toString: () => '-50.00' }, currency: 'PEN' },
      ],
    });
    await expect(
      service.voidTransaction(contextA, { id: txId, occurredOn: '2026-11-21' }),
    ).rejects.toMatchObject({
      error: {
        statusCode: 400,
        message: 'Void date cannot be earlier than original transaction date',
      },
    });

    // 5) Has refunds -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      occurredOn: limaDate,
      fundEntries: [
        { id: entryId, fundId, signedAmount: { toString: () => '-50.00' }, currency: 'PEN' },
      ],
    });
    prismaMock.financialTransaction.count.mockResolvedValueOnce(1);
    await expect(
      service.voidTransaction(contextA, { id: txId, occurredOn: '2026-11-22' }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // 6) Overdraft when voiding INCOME with allowNegativeBalance=false -> 409
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: txId }])
      .mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'INCOME',
      status: 'POSTED',
      amount: { toString: () => '200.00' },
      occurredOn: limaDate,
      description: 'Ingreso',
      fundEntries: [
        { id: entryId, fundId, signedAmount: { toString: () => '200.00' }, currency: 'PEN' },
      ],
    });
    prismaMock.financialTransaction.count.mockResolvedValueOnce(0);
    prismaMock.fund.findMany.mockResolvedValueOnce([
      {
        id: fundId,
        userId: userA,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      },
    ]);
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '150.00' } },
    });
    await expect(
      service.voidTransaction(contextA, { id: txId, occurredOn: '2026-11-22' }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // 7) Early idempotency guard rejects mismatched type/target without querying original
    const findFirstCallsBeforeVoidGuard =
      prismaMock.financialTransaction.findFirst.mock.calls.length;
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: '77777777-7777-4777-8777-777777777777',
      type: 'INCOME',
      relatedTransactionId: null,
      occurredOn: limaDate,
      description: 'Otra cosa',
      notes: null,
      fundEntries: [],
      transactionSplits: [],
    });
    await expect(
      service.voidTransaction(contextA, { id: txId, idempotencyKey: 'idem-void-mismatch' }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });
    expect(prismaMock.financialTransaction.findFirst).toHaveBeenCalledTimes(
      findFirstCallsBeforeVoidGuard + 1,
    );

    // 8) Concurrent P2002 on single_void_per_related_uidx -> 409
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({ id: 'void-winner-id' });
    await expect(service.voidTransaction(contextA, { id: txId })).rejects.toMatchObject({
      error: { statusCode: 409 },
    });
  });

  it('records partial REFUNDs, rejects over-refund by 0.01, non-EXPENSE, VOIDED, earlier date, and enforces early idempotency guard', async () => {
    const refundTxId = '66666666-6666-4666-8666-666666666666';

    // 1) Partial refund 60.00 on 100.00 EXPENSE
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: txId }])
      .mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '100.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      description: 'Compra',
      categoryId: catExpenseId1,
      fundEntries: [
        { id: entryId, fundId, signedAmount: { toString: () => '-100.00' }, currency: 'PEN' },
      ],
    });
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      isArchived: false,
    });
    prismaMock.financialTransaction.aggregate.mockResolvedValueOnce({
      _sum: { amount: null },
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '380.00' } },
    });
    prismaMock.financialTransaction.create.mockResolvedValueOnce({
      id: refundTxId,
      type: 'REFUND',
      status: 'POSTED',
      amount: { toString: () => '60.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      recordedAt: baseNow,
      description: 'Reembolso: Compra',
      notes: null,
      categoryId: catExpenseId1,
      relatedTransactionId: txId,
      idempotencyKey: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.create.mockResolvedValueOnce({
      id: '55555555-5555-4555-8555-555555555555',
      fundId,
      signedAmount: { toString: () => '60.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      createdAt: baseNow,
    });

    const refund1 = await service.refundTransaction(contextA, {
      id: txId,
      amount: '60.00',
      occurredOn: '2026-11-22',
    });
    expect(refund1.totalRefundedAfter).toBe('60.00');
    expect(refund1.remainingRefundableAmount).toBe('40.00');
    expect(refund1.fundBalanceAfter).toBe('440.00');
    expect(refund1.refundTransaction.description).toBe('Reembolso: Compra');

    // 2) Second refund 40.01 exceeds remaining 40.00 -> 409
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: txId }])
      .mockResolvedValueOnce([{ id: fundId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '100.00' },
      currency: 'PEN',
      occurredOn: limaDate,
      description: 'Compra',
      categoryId: catExpenseId1,
      fundEntries: [
        { id: entryId, fundId, signedAmount: { toString: () => '-100.00' }, currency: 'PEN' },
      ],
    });
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId,
      userId: userA,
      currency: 'PEN',
      isArchived: false,
    });
    prismaMock.financialTransaction.aggregate.mockResolvedValueOnce({
      _sum: { amount: { toString: () => '60.00' } },
    });
    await expect(
      service.refundTransaction(contextA, {
        id: txId,
        amount: '40.01',
        occurredOn: '2026-11-22',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // 3) Chronological coherence: occurredOn earlier than original -> 400
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'POSTED',
      amount: { toString: () => '100.00' },
      occurredOn: limaDate,
      fundEntries: [{ id: entryId, fundId }],
    });
    await expect(
      service.refundTransaction(contextA, {
        id: txId,
        amount: '10.00',
        occurredOn: '2026-11-21',
      }),
    ).rejects.toMatchObject({
      error: {
        statusCode: 400,
        message: 'Refund date cannot be earlier than original transaction date',
      },
    });

    // 4) Non-EXPENSE -> 400; VOIDED -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'INCOME',
      status: 'POSTED',
      occurredOn: limaDate,
      fundEntries: [{ id: entryId, fundId }],
    });
    await expect(
      service.refundTransaction(contextA, { id: txId, amount: '10.00' }),
    ).rejects.toMatchObject({ error: { statusCode: 400 } });

    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: txId }]);
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: txId,
      type: 'EXPENSE',
      status: 'VOIDED',
      occurredOn: limaDate,
      fundEntries: [{ id: entryId, fundId }],
    });
    await expect(
      service.refundTransaction(contextA, { id: txId, amount: '10.00' }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });

    // 5) Early idempotency guard when type or relatedTransactionId differs
    const findFirstCallsBeforeRefundGuard =
      prismaMock.financialTransaction.findFirst.mock.calls.length;
    prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
      id: refundTxId,
      type: 'REFUND',
      relatedTransactionId: '99999999-9999-4999-8999-999999999999',
      occurredOn: limaDate,
      description: 'Reembolso',
      notes: null,
      fundEntries: [],
      transactionSplits: [],
    });
    await expect(
      service.refundTransaction(contextA, {
        id: txId,
        amount: '10.00',
        idempotencyKey: 'idem-refund-mismatch',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 409 } });
    expect(prismaMock.financialTransaction.findFirst).toHaveBeenCalledTimes(
      findFirstCallsBeforeRefundGuard + 1,
    );
  });

  it('lists transactions with userId isolation, split-aware categoryId filter, date range, search, and pagination', async () => {
    prismaMock.financialTransaction.count.mockResolvedValueOnce(1);
    prismaMock.financialTransaction.findMany.mockResolvedValueOnce([
      {
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '120.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Supermercado',
        notes: 'Compra semanal',
        categoryId: null,
        relatedTransactionId: null,
        idempotencyKey: null,
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
            id: splitId1,
            categoryId: catExpenseId1,
            amount: { toString: () => '80.00' },
            note: 'Alimentos',
            createdAt: baseNow,
          },
          {
            id: splitId2,
            categoryId: catExpenseId2,
            amount: { toString: () => '40.00' },
            note: null,
            createdAt: baseNow,
          },
        ],
      },
    ]);

    const res = await service.listTransactions(contextA, {
      page: 1,
      limit: 10,
      fundId: fundId.toUpperCase(),
      categoryId: catExpenseId2.toUpperCase(),
      type: 'EXPENSE',
      status: 'POSTED',
      currency: 'PEN',
      fromDate: '2026-11-01',
      toDate: '2026-11-22',
      search: '  super  ',
    });

    expect(res.total).toBe(1);
    expect(res.totalPages).toBe(1);
    expect(res.items[0].splits).toHaveLength(2);
    const findManyCalls = prismaMock.financialTransaction.findMany.mock.calls as Array<
      [{ where: Record<string, unknown>; orderBy: unknown[] }]
    >;
    const findManyArg = findManyCalls[0][0];
    expect(findManyArg.where.userId).toBe(userA);
    expect(findManyArg.where.fundEntries).toEqual({
      some: { userId: userA, fundId },
    });
    expect(findManyArg.orderBy).toEqual([
      { occurredOn: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);

    await expect(
      service.listTransactions(contextA, {
        fromDate: '2026-11-25',
        toDate: '2026-11-10',
      }),
    ).rejects.toMatchObject({ error: { statusCode: 400 } });
  });

  it('computes monthly summary with America/Lima night default, leap-year bounds, multi-currency separation, split deduplication, empty month, and fundId isolation', async () => {
    // 1) Night window 2026-12-01T02:30:00.000Z === 2026-11-30 21:30 America/Lima -> defaults to "2026-11" and returns currencies: [] when empty
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-01T02:30:00.000Z'));
    prismaMock.financialTransaction.findMany.mockResolvedValueOnce([]);

    const emptySummary = await service.getMonthlySummary(contextA, {});
    expect(emptySummary).toEqual({
      month: '2026-11',
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
      fundId: null,
      currencies: [],
    });
    jest.useRealTimers();

    // 2) Leap year 2024-02 -> 2024-02-01..2024-02-29 vs non-leap 2026-02 -> 2026-02-01..2026-02-28
    prismaMock.financialTransaction.findMany.mockResolvedValueOnce([]);
    const leap = await service.getMonthlySummary(contextA, { month: '2024-02' });
    expect(leap.fromDate).toBe('2024-02-01');
    expect(leap.toDate).toBe('2024-02-29');

    prismaMock.financialTransaction.findMany.mockResolvedValueOnce([]);
    const nonLeap = await service.getMonthlySummary(contextA, { month: '2026-02' });
    expect(nonLeap.fromDate).toBe('2026-02-01');
    expect(nonLeap.toDate).toBe('2026-02-28');

    // 3) Cross-user fundId -> 404
    prismaMock.fund.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.getMonthlySummary(contextA, { month: '2026-11', fundId }),
    ).rejects.toMatchObject({ error: { statusCode: 404 } });

    // 4) Multi-currency (PEN & USD) with splits (no double count) and REFUND subtracted in net
    prismaMock.fund.findFirst.mockResolvedValueOnce({ id: fundId });
    prismaMock.financialTransaction.findMany.mockResolvedValueOnce([
      {
        id: 'tx-1',
        type: 'INCOME',
        amount: { toString: () => '3000.00' },
        currency: 'PEN',
        category: {
          id: catIncomeId,
          name: 'Sueldo',
          kind: 'INCOME',
          color: '#10B981',
          icon: 'wallet',
        },
        transactionSplits: [],
      },
      {
        id: 'tx-2',
        type: 'EXPENSE',
        amount: { toString: () => '120.00' },
        currency: 'PEN',
        category: null,
        transactionSplits: [
          {
            amount: { toString: () => '80.00' },
            category: {
              id: catExpenseId1,
              name: 'Alimentos',
              kind: 'EXPENSE',
              color: null,
              icon: null,
            },
          },
          {
            amount: { toString: () => '40.00' },
            category: {
              id: catExpenseId2,
              name: 'Limpieza',
              kind: 'EXPENSE',
              color: null,
              icon: null,
            },
          },
        ],
      },
      {
        id: 'tx-3',
        type: 'REFUND',
        amount: { toString: () => '20.00' },
        currency: 'PEN',
        category: {
          id: catExpenseId1,
          name: 'Alimentos',
          kind: 'EXPENSE',
          color: null,
          icon: null,
        },
        transactionSplits: [],
      },
      {
        id: 'tx-4',
        type: 'INCOME',
        amount: { toString: () => '500.00' },
        currency: 'USD',
        category: {
          id: catIncomeId,
          name: 'Sueldo',
          kind: 'INCOME',
          color: '#10B981',
          icon: 'wallet',
        },
        transactionSplits: [],
      },
    ]);

    const summary = await service.getMonthlySummary(contextA, {
      month: '2026-11',
      fundId: fundId.toUpperCase(),
    });

    expect(summary.fundId).toBe(fundId);
    expect(summary.currencies).toHaveLength(2);
    expect(summary.currencies[0]).toMatchObject({
      currency: 'PEN',
      totalIncome: '3000.00',
      totalExpenseGross: '120.00',
      totalRefunds: '20.00',
      totalExpenseNet: '100.00',
      netCashFlow: '2900.00',
      transactionCount: 3,
    });
    expect(summary.currencies[0].byCategory.map((c) => [c.categoryName, c.totalAmount])).toEqual([
      ['Sueldo', '3000.00'],
      ['Alimentos', '80.00'],
      ['Limpieza', '40.00'],
    ]);
    expect(summary.currencies[1]).toMatchObject({
      currency: 'USD',
      totalIncome: '500.00',
      totalExpenseGross: '0.00',
      totalRefunds: '0.00',
      totalExpenseNet: '0.00',
      netCashFlow: '500.00',
      transactionCount: 1,
    });
  });
});
