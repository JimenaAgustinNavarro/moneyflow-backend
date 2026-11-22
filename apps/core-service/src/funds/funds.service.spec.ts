import { RpcException } from '@nestjs/microservices';
import { InternalAuthContext } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FundsService } from './funds.service';

describe('FundsService', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const fundId1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fundId2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const fundId3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const txId1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const contextA: InternalAuthContext = {
    requestId: 'req-1',
    userId: userA,
    timestamp: Date.now(),
    signature: 'sig',
  };

  const baseNow = new Date('2026-11-22T15:00:00.000Z');

  let prismaMock: {
    fund: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    fundEntry: {
      groupBy: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    financialTransaction: {
      create: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  let service: FundsService;

  beforeEach(() => {
    prismaMock = {
      fund: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      fundEntry: {
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      financialTransaction: {
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
    );

    service = new FundsService(prismaMock as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists funds with derived positive, negative, and zero balances using a single groupBy and deterministic totalsByCurrency', async () => {
    prismaMock.fund.findMany.mockResolvedValue([
      {
        id: fundId2,
        userId: userA,
        name: 'Ahorro USD',
        type: 'SAVINGS',
        currency: 'USD',
        color: '#2563EB',
        icon: 'piggy-bank',
        allowNegativeBalance: false,
        isArchived: false,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
      {
        id: fundId1,
        userId: userA,
        name: 'Efectivo',
        type: 'CASH',
        currency: 'PEN',
        color: '#10B981',
        icon: 'wallet',
        allowNegativeBalance: false,
        isArchived: false,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
      {
        id: fundId3,
        userId: userA,
        name: 'Billetera',
        type: 'WALLET',
        currency: 'PEN',
        color: null,
        icon: null,
        allowNegativeBalance: true,
        isArchived: false,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
    ]);

    prismaMock.fundEntry.groupBy.mockResolvedValue([
      { fundId: fundId1, _sum: { signedAmount: { toString: () => '1250.5' } } },
      { fundId: fundId3, _sum: { signedAmount: { toString: () => '-40' } } },
    ]);

    const result = await service.list(contextA, {});

    expect(prismaMock.fundEntry.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.fundEntry.groupBy).toHaveBeenCalledWith({
      by: ['fundId'],
      where: {
        userId: userA,
        fundId: { in: [fundId2, fundId1, fundId3] },
      },
      _sum: { signedAmount: true },
    });

    expect(result.funds.map((f) => ({ id: f.id, balance: f.balance }))).toEqual([
      { id: fundId2, balance: '0.00' },
      { id: fundId1, balance: '1250.50' },
      { id: fundId3, balance: '-40.00' },
    ]);

    // Deterministic order: PEN first, then USD
    expect(result.totalsByCurrency).toEqual([
      { currency: 'PEN', totalBalance: '1210.50', fundCount: 2 },
      { currency: 'USD', totalBalance: '0.00', fundCount: 1 },
    ]);
  });

  it('returns empty funds and empty totalsByCurrency when user has no funds', async () => {
    prismaMock.fund.findMany.mockResolvedValue([]);

    const result = await service.list(contextA, { currency: 'USD', includeArchived: true });

    expect(prismaMock.fundEntry.groupBy).not.toHaveBeenCalled();
    expect(result).toEqual({
      funds: [],
      totalsByCurrency: [],
    });
  });

  it('gets fund detail with derived balance and entryCount, and throws 404 for another user', async () => {
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId1,
      userId: userA,
      name: 'Cuenta BCP',
      type: 'BANK',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '350.25' } },
      _count: { _all: 4 },
    });

    const detail = await service.getById(contextA, { id: fundId1 });
    expect(detail.fund.balance).toBe('350.25');
    expect(detail.fund.entryCount).toBe(4);

    prismaMock.fund.findFirst.mockResolvedValueOnce(null);
    await expect(service.getById(contextA, { id: fundId2 })).rejects.toMatchObject({
      error: { statusCode: 404 },
    });
  });

  it('creates a fund without initialBalance or with "0.00" without creating ledger entries', async () => {
    prismaMock.fund.create.mockResolvedValue({
      id: fundId1,
      userId: userA,
      name: 'Efectivo',
      type: 'CASH',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });

    const created = await service.create(contextA, {
      name: 'Efectivo',
      type: 'CASH',
      initialBalance: '0.00',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.financialTransaction.create).not.toHaveBeenCalled();
    expect(created.fund.balance).toBe('0.00');
  });

  it('creates a fund with positive initialBalance in an ACID transaction and uses America/Lima calendar date during 19:00-23:59 Lima', async () => {
    jest.useFakeTimers();
    // 2026-11-23T02:30:00.000Z === 2026-11-22 21:30:00 America/Lima (UTC-5)
    jest.setSystemTime(new Date('2026-11-23T02:30:00.000Z'));

    prismaMock.fund.create.mockResolvedValue({
      id: fundId1,
      userId: userA,
      name: 'Caja Chica',
      type: 'CASH',
      currency: 'PEN',
      color: '#10B981',
      icon: 'wallet',
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.financialTransaction.create.mockResolvedValue({ id: txId1 });
    prismaMock.fundEntry.create.mockResolvedValue({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });

    const result = await service.create(contextA, {
      name: 'Caja Chica',
      type: 'CASH',
      currency: 'PEN',
      color: '#10B981',
      icon: 'wallet',
      initialBalance: '500.5',
    });

    const expectedLimaDate = new Date('2026-11-22T00:00:00.000Z');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.financialTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: userA,
        type: 'ADJUSTMENT',
        status: 'POSTED',
        amount: '500.50',
        currency: 'PEN',
        occurredOn: expectedLimaDate,
        description: 'Saldo inicial',
      },
    });
    expect(prismaMock.fundEntry.create).toHaveBeenCalledWith({
      data: {
        userId: userA,
        transactionId: txId1,
        fundId: fundId1,
        signedAmount: '500.50',
        currency: 'PEN',
        occurredOn: expectedLimaDate,
      },
    });
    expect(result.fund.balance).toBe('500.50');
  });

  it('propagates failure and rolls back when fundEntry creation fails during initialBalance transaction', async () => {
    prismaMock.fund.create.mockResolvedValue({
      id: fundId1,
      userId: userA,
      name: 'Cuenta',
      type: 'BANK',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.financialTransaction.create.mockResolvedValue({ id: txId1 });
    prismaMock.fundEntry.create.mockRejectedValue(new Error('DB write failure'));

    await expect(
      service.create(contextA, {
        name: 'Cuenta',
        type: 'BANK',
        initialBalance: '100.00',
      }),
    ).rejects.toThrow('DB write failure');
  });

  it('rejects invalid initialBalance values and maps P2002 unique violations to 409 Conflict', async () => {
    for (const invalid of ['-10.00', 'NaN', 'Infinity', '10.123', '1000000000000.00']) {
      await expect(
        service.create(contextA, {
          name: 'Test',
          type: 'CASH',
          initialBalance: invalid,
        }),
      ).rejects.toBeInstanceOf(RpcException);
    }

    prismaMock.fund.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.create(contextA, {
        name: 'Efectivo',
        type: 'CASH',
      }),
    ).rejects.toMatchObject({
      error: { statusCode: 409 },
    });
  });

  it('updates fund metadata with FOR UPDATE lock and returns the real derived balance', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: fundId1 }]);
    prismaMock.fund.findFirst.mockResolvedValue({
      id: fundId1,
      userId: userA,
      name: 'Cuenta Antigua',
      type: 'BANK',
      currency: 'PEN',
      color: '#111111',
      icon: 'bank',
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValue({
      _sum: { signedAmount: { toString: () => '350.25' } },
    });
    prismaMock.fund.update.mockResolvedValue({
      id: fundId1,
      userId: userA,
      name: 'Cuenta Nueva',
      type: 'BANK',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });

    const result = await service.update(contextA, {
      id: fundId1,
      name: 'Cuenta Nueva',
      color: null,
      icon: null,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.fund.update).toHaveBeenCalledWith({
      where: { id: fundId1 },
      data: {
        name: 'Cuenta Nueva',
        color: null,
        icon: null,
      },
    });
    expect(result.fund.balance).toBe('350.25');
    expect(result.fund.color).toBeNull();
    expect(result.fund.icon).toBeNull();
  });

  it('blocks disabling allowNegativeBalance when derived balance is negative and blocks updating archived funds', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: fundId1 }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId1,
      userId: userA,
      name: 'Tarjeta',
      type: 'WALLET',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: true,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '-25.00' } },
    });

    await expect(
      service.update(contextA, { id: fundId1, allowNegativeBalance: false }),
    ).rejects.toMatchObject({
      error: { statusCode: 409 },
    });

    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId1,
      userId: userA,
      name: 'Archivado',
      type: 'CASH',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: true,
      createdAt: baseNow,
      updatedAt: baseNow,
    });

    await expect(service.update(contextA, { id: fundId1, name: 'Otro' })).rejects.toMatchObject({
      error: { statusCode: 409 },
    });
  });

  it('archives a fund with FOR UPDATE lock only when balance is 0.00 and rejects non-zero balance or cross-user access', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId1 }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId1,
      userId: userA,
      name: 'Fondo Cero',
      type: 'CASH',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: null },
    });
    prismaMock.fund.update.mockResolvedValueOnce({
      id: fundId1,
      userId: userA,
      name: 'Fondo Cero',
      type: 'CASH',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: true,
      createdAt: baseNow,
      updatedAt: baseNow,
    });

    const archived = await service.archive(contextA, { id: fundId1 });
    expect(archived.fund.isArchived).toBe(true);
    expect(archived.fund.balance).toBe('0.00');

    // Non-zero balance -> 409
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: fundId2 }]);
    prismaMock.fund.findFirst.mockResolvedValueOnce({
      id: fundId2,
      userId: userA,
      name: 'Con Saldo',
      type: 'BANK',
      currency: 'PEN',
      color: null,
      icon: null,
      allowNegativeBalance: false,
      isArchived: false,
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
      _sum: { signedAmount: { toString: () => '10.00' } },
    });

    await expect(service.archive(contextA, { id: fundId2 })).rejects.toMatchObject({
      error: { statusCode: 409 },
    });

    // Cross-user / missing lock -> 404
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.archive(contextA, { id: fundId3 })).rejects.toMatchObject({
      error: { statusCode: 404 },
    });
  });
});
