import { InternalAuthContext } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PlanningService } from './planning.service';

describe('PlanningService', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const ruleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const occId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const fundId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const catExpenseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const catIncomeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const txId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  const contextA: InternalAuthContext = {
    requestId: 'req-plan-1',
    userId: userA,
    timestamp: Date.now(),
    signature: 'sig',
  };

  const baseNow = new Date('2026-11-26T20:00:00.000Z');
  const limaDate = new Date('2026-11-26T00:00:00.000Z');

  const makeRule = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: ruleId,
    userId: userA,
    name: 'Alquiler',
    kind: 'EXPENSE',
    amount: { toString: () => '1500.00' },
    currency: 'PEN',
    frequency: 'MONTHLY',
    startDate: new Date('2026-11-30T00:00:00.000Z'),
    endDate: null,
    anchorDay: 30,
    categoryId: catExpenseId,
    defaultFundId: fundId,
    notes: null,
    isActive: true,
    isArchived: false,
    createdAt: baseNow,
    updatedAt: baseNow,
    ...overrides,
  });

  const makeOccurrence = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: occId,
    userId: userA,
    ruleId,
    scheduledDate: new Date('2026-11-30T00:00:00.000Z'),
    expectedAmount: { toString: () => '1500.00' },
    currency: 'PEN',
    status: 'PENDING',
    paidTransactionId: null,
    paidAmount: null,
    paidAt: null,
    skippedAt: null,
    lastVoidedTransactionId: null,
    lastVoidedAt: null,
    createdAt: baseNow,
    updatedAt: baseNow,
    rule: {
      id: ruleId,
      name: 'Alquiler',
      kind: 'EXPENSE',
      currency: 'PEN',
      frequency: 'MONTHLY',
      categoryId: catExpenseId,
      defaultFundId: fundId,
      isActive: true,
      isArchived: false,
    },
    ...overrides,
  });

  let prismaMock: {
    recurringRule: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    recurringOccurrence: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    category: { findFirst: jest.Mock };
    fund: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    financialTransaction: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    fundEntry: {
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  let service: PlanningService;

  beforeEach(() => {
    prismaMock = {
      recurringRule: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      recurringOccurrence: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      category: { findFirst: jest.fn() },
      fund: { findFirst: jest.fn(), findMany: jest.fn() },
      financialTransaction: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      fundEntry: { aggregate: jest.fn(), create: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
    );

    service = new PlanningService(prismaMock as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── createRule ──────────────────────────────────────────────────────────────

  describe('createRule', () => {
    it('creates EXPENSE rule with system category (userId === null)', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catExpenseId,
        kind: 'EXPENSE',
        isArchived: false,
      });
      prismaMock.fund.findFirst.mockResolvedValueOnce({
        id: fundId,
        currency: 'PEN',
        isArchived: false,
      });
      const created = makeRule();
      prismaMock.recurringRule.create.mockResolvedValueOnce(created);
      prismaMock.recurringOccurrence.createMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.createRule(contextA, {
        name: 'Alquiler',
        kind: 'EXPENSE',
        amount: '1500.00',
        currency: 'PEN',
        frequency: 'MONTHLY',
        startDate: '2026-11-30',
        categoryId: catExpenseId,
        defaultFundId: fundId,
      });

      expect(result.rule.kind).toBe('EXPENSE');
      expect(result.rule.amount).toBe('1500.00');
      expect(result.materializedCount).toBe(2);
    });

    it('creates INCOME rule with user-owned category', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catIncomeId,
        kind: 'INCOME',
        isArchived: false,
      });
      const created = makeRule({ kind: 'INCOME', categoryId: catIncomeId, defaultFundId: null });
      prismaMock.recurringRule.create.mockResolvedValueOnce(created);
      prismaMock.recurringOccurrence.createMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.createRule(contextA, {
        name: 'Alquiler',
        kind: 'INCOME',
        amount: '1500.00',
        currency: 'PEN',
        frequency: 'MONTHLY',
        startDate: '2026-11-30',
        categoryId: catIncomeId,
      });

      expect(result.rule.kind).toBe('INCOME');
    });

    it('rejects with 400 when kind mismatches category', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catIncomeId,
        kind: 'INCOME',
        isArchived: false,
      });

      await expect(
        service.createRule(contextA, {
          name: 'Test',
          kind: 'EXPENSE',
          amount: '100.00',
          currency: 'PEN',
          frequency: 'MONTHLY',
          startDate: '2026-11-30',
          categoryId: catIncomeId,
        }),
      ).rejects.toMatchObject({ error: { statusCode: 400 } });
    });

    it('rejects with 404 when category belongs to another user', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createRule(contextA, {
          name: 'Test',
          kind: 'EXPENSE',
          amount: '100.00',
          currency: 'PEN',
          frequency: 'MONTHLY',
          startDate: '2026-11-30',
          categoryId: catExpenseId,
        }),
      ).rejects.toMatchObject({ error: { statusCode: 404 } });
    });

    it('rejects with 409 when category is archived', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catExpenseId,
        kind: 'EXPENSE',
        isArchived: true,
      });

      await expect(
        service.createRule(contextA, {
          name: 'Test',
          kind: 'EXPENSE',
          amount: '100.00',
          currency: 'PEN',
          frequency: 'MONTHLY',
          startDate: '2026-11-30',
          categoryId: catExpenseId,
        }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('rejects with 400 when defaultFund currency mismatches rule currency', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catExpenseId,
        kind: 'EXPENSE',
        isArchived: false,
      });
      prismaMock.fund.findFirst.mockResolvedValueOnce({
        id: fundId,
        currency: 'USD',
        isArchived: false,
      });

      await expect(
        service.createRule(contextA, {
          name: 'Test',
          kind: 'EXPENSE',
          amount: '100.00',
          currency: 'PEN',
          frequency: 'MONTHLY',
          startDate: '2026-11-30',
          categoryId: catExpenseId,
          defaultFundId: fundId,
        }),
      ).rejects.toMatchObject({ error: { statusCode: 400 } });
    });

    it('rejects with 400 when endDate < startDate', async () => {
      await expect(
        service.createRule(contextA, {
          name: 'Test',
          kind: 'EXPENSE',
          amount: '100.00',
          currency: 'PEN',
          frequency: 'MONTHLY',
          startDate: '2026-11-30',
          endDate: '2026-11-01',
          categoryId: catExpenseId,
        }),
      ).rejects.toMatchObject({ error: { statusCode: 400 } });
    });

    it('rejects cross-user category (null returned) -> 404', async () => {
      prismaMock.category.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createRule(contextA, {
          name: 'Test',
          kind: 'EXPENSE',
          amount: '100.00',
          currency: 'PEN',
          frequency: 'MONTHLY',
          startDate: '2026-11-30',
          categoryId: catExpenseId,
        }),
      ).rejects.toMatchObject({ error: { statusCode: 404 } });
    });
  });

  // ─── updateRule ──────────────────────────────────────────────────────────────

  describe('updateRule', () => {
    it('rejects body with no updatable fields with 400', async () => {
      await expect(service.updateRule(contextA, { id: ruleId })).rejects.toMatchObject({
        error: { statusCode: 400 },
      });
    });

    it('rejects update of archived rule with 409', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(
        makeRule({ isArchived: true, isActive: false }),
      );

      await expect(
        service.updateRule(contextA, { id: ruleId, name: 'Nuevo nombre' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('rejects endDate < startDate with merged values -> 400', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(
        makeRule({ startDate: new Date('2026-11-30T00:00:00.000Z') }),
      );

      await expect(
        service.updateRule(contextA, {
          id: ruleId,
          endDate: '2026-11-01', // before startDate 2026-11-30
        }),
      ).rejects.toMatchObject({ error: { statusCode: 400 } });
    });

    it('updates only amount -> updates PENDING >= hoy_Lima, preserves PAID, SKIPPED and overdue', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T05:00:00.000Z')); // 2026-11-26 Lima

      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: ruleId }]) // lock rule
        .mockResolvedValueOnce([]); // lock occurrences
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule());
      prismaMock.category.findFirst.mockResolvedValueOnce(null); // not called for amount-only
      const updatedRule = makeRule({ amount: { toString: () => '2000.00' } });
      prismaMock.recurringRule.update.mockResolvedValueOnce(updatedRule);
      prismaMock.recurringOccurrence.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.updateRule(contextA, { id: ruleId, amount: '2000.00' });
      expect(result.rule.amount).toBe('2000.00');
      expect(prismaMock.recurringOccurrence.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { expectedAmount: '2000.00' },
        }),
      );
    });

    it('regenerates PENDING >= hoy_Lima when frequency changes', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T05:00:00.000Z'));

      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]).mockResolvedValueOnce([]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule({ frequency: 'MONTHLY' }));
      const updatedRule = makeRule({ frequency: 'WEEKLY' });
      prismaMock.recurringRule.update.mockResolvedValueOnce(updatedRule);
      prismaMock.recurringOccurrence.deleteMany.mockResolvedValueOnce({ count: 2 });
      prismaMock.recurringOccurrence.createMany.mockResolvedValueOnce({ count: 8 });

      await service.updateRule(contextA, { id: ruleId, frequency: 'WEEKLY' });

      const deleteCall = (
        prismaMock.recurringOccurrence.deleteMany.mock.calls as unknown[][]
      )[0]?.[0] as {
        where: Record<string, unknown>;
      };
      expect(deleteCall.where).toMatchObject({ status: 'PENDING' });
      expect(prismaMock.recurringOccurrence.createMany).toHaveBeenCalled();
    });

    it('revalidates categoryId with same kind when provided', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]).mockResolvedValueOnce([]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule());
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catExpenseId,
        kind: 'EXPENSE',
        isArchived: false,
      });
      const updatedRule = makeRule();
      prismaMock.recurringRule.update.mockResolvedValueOnce(updatedRule);

      const result = await service.updateRule(contextA, {
        id: ruleId,
        categoryId: catExpenseId,
      });

      expect(result.rule.categoryId).toBe(catExpenseId);
      const catCall = (prismaMock.category.findFirst.mock.calls as unknown[][])[0]?.[0] as {
        where: Record<string, unknown>;
      };
      expect(catCall.where).toMatchObject({ id: catExpenseId });
    });
  });

  // ─── pause / resume / archive ─────────────────────────────────────────────

  describe('pauseRule', () => {
    it('pauses an active rule', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule({ isActive: true }));
      prismaMock.recurringRule.update.mockResolvedValueOnce(makeRule({ isActive: false }));

      const result = await service.pauseRule(contextA, { id: ruleId });
      expect(result.rule.isActive).toBe(false);
    });

    it('returns 200 idempotently if already paused', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule({ isActive: false }));

      const result = await service.pauseRule(contextA, { id: ruleId });
      expect(result.rule.isActive).toBe(false);
      expect(prismaMock.recurringRule.update).not.toHaveBeenCalled();
    });

    it('rejects with 409 if rule is archived', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(
        makeRule({ isArchived: true, isActive: false }),
      );

      await expect(service.pauseRule(contextA, { id: ruleId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });
  });

  describe('resumeRule', () => {
    it('resumes a paused rule and materializes occurrences', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule({ isActive: false }));
      prismaMock.recurringRule.update.mockResolvedValueOnce(makeRule({ isActive: true }));
      prismaMock.recurringOccurrence.createMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.resumeRule(contextA, { id: ruleId });
      expect(result.rule.isActive).toBe(true);
      expect(prismaMock.recurringOccurrence.createMany).toHaveBeenCalled();
    });

    it('returns 200 idempotently if already active', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule({ isActive: true }));
      prismaMock.recurringOccurrence.createMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.resumeRule(contextA, { id: ruleId });
      expect(result.rule.isActive).toBe(true);
      expect(prismaMock.recurringRule.update).not.toHaveBeenCalled();
    });

    it('rejects with 409 if rule is archived', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(
        makeRule({ isArchived: true, isActive: false }),
      );

      await expect(service.resumeRule(contextA, { id: ruleId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });
  });

  describe('archiveRule', () => {
    it('archives rule and deletes future PENDING occurrences, preserves PAID', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: ruleId }]) // lock rule
        .mockResolvedValueOnce([]); // lock occurrences
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(makeRule());
      prismaMock.recurringOccurrence.deleteMany.mockResolvedValueOnce({ count: 3 });
      prismaMock.recurringRule.update.mockResolvedValueOnce(
        makeRule({ isArchived: true, isActive: false }),
      );

      const result = await service.archiveRule(contextA, { id: ruleId });
      expect(result.rule.isArchived).toBe(true);
      expect(result.deletedPendingCount).toBe(3);
    });

    it('rejects with 409 if rule is already archived', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([{ id: ruleId }]);
      prismaMock.recurringRule.findFirst.mockResolvedValueOnce(
        makeRule({ isArchived: true, isActive: false }),
      );

      await expect(service.archiveRule(contextA, { id: ruleId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });
  });

  // ─── listOccurrences ──────────────────────────────────────────────────────

  describe('listOccurrences', () => {
    it('materializes [hoy_Lima, hoy_Lima + 60d] and includes overdue PENDING without fromDate', async () => {
      jest.useFakeTimers();
      // 22:30 Lima = 2026-11-26 in America/Lima
      jest.setSystemTime(new Date('2026-11-27T03:30:00.000Z'));

      prismaMock.recurringRule.findMany.mockResolvedValueOnce([makeRule()]);
      prismaMock.recurringOccurrence.createMany.mockResolvedValueOnce({ count: 2 });

      // Overdue occurrence (before 2026-11-26)
      const overdueOcc = makeOccurrence({
        scheduledDate: new Date('2026-11-20T00:00:00.000Z'),
        status: 'PENDING',
      });
      // Future occurrence within horizon
      const futureOcc = makeOccurrence({
        id: '99999999-9999-4999-8999-999999999999',
        scheduledDate: new Date('2026-11-30T00:00:00.000Z'),
        status: 'PENDING',
      });

      prismaMock.recurringOccurrence.findMany.mockResolvedValueOnce([overdueOcc, futureOcc]);

      const result = await service.listOccurrences(contextA, {});

      expect(result.horizonStart).toBe('2026-11-26');
      expect(result.horizonEnd).toBe('2027-01-25');
      expect(result.occurrences[0].isOverdue).toBe(true);
      expect(result.occurrences[1].isOverdue).toBe(false);
    });

    it('with fromDate: filters strictly >= fromDate, no overdue logic', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T03:30:00.000Z')); // 2026-11-26 22:30 Lima

      prismaMock.recurringRule.findMany.mockResolvedValueOnce([]);
      prismaMock.recurringOccurrence.findMany.mockResolvedValueOnce([makeOccurrence()]);

      const result = await service.listOccurrences(contextA, {
        fromDate: '2026-11-26',
        toDate: '2026-12-31',
      });

      expect(result.horizonStart).toBe('2026-11-26');
      // The findMany should have been called with scheduledDate >= fromDate
      const findManyCall = (
        prismaMock.recurringOccurrence.findMany.mock.calls as Array<
          [{ where: { scheduledDate: { gte: Date } } }]
        >
      )[0][0];
      expect(findManyCall.where.scheduledDate.gte).toBeInstanceOf(Date);
    });

    it('rejects fromDate > toDate with 400', async () => {
      await expect(
        service.listOccurrences(contextA, { fromDate: '2026-12-01', toDate: '2026-11-01' }),
      ).rejects.toMatchObject({ error: { statusCode: 400 } });
    });

    it('totalsByCurrency: PEN first, USD second; sums expected_amount for PENDING, paid_amount for PAID', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T05:00:00.000Z'));

      prismaMock.recurringRule.findMany.mockResolvedValueOnce([]);

      const pendingPen = makeOccurrence({
        currency: 'PEN',
        status: 'PENDING',
        expectedAmount: { toString: () => '1500.00' },
        paidAmount: null,
        rule: {
          id: ruleId,
          name: 'Alquiler',
          kind: 'EXPENSE',
          currency: 'PEN',
          frequency: 'MONTHLY',
          categoryId: catExpenseId,
          defaultFundId: fundId,
          isActive: true,
          isArchived: false,
        },
      });
      const paidUsd = makeOccurrence({
        id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        currency: 'USD',
        status: 'PAID',
        expectedAmount: { toString: () => '100.00' },
        paidAmount: { toString: () => '95.00' },
        paidTransactionId: txId,
        paidAt: baseNow,
        rule: {
          id: ruleId,
          name: 'Sueldo USD',
          kind: 'INCOME',
          currency: 'USD',
          frequency: 'MONTHLY',
          categoryId: catIncomeId,
          defaultFundId: null,
          isActive: true,
          isArchived: false,
        },
      });

      prismaMock.recurringOccurrence.findMany.mockResolvedValueOnce([pendingPen, paidUsd]);

      const result = await service.listOccurrences(contextA, {});

      expect(result.totalsByCurrency[0].currency).toBe('PEN');
      expect(result.totalsByCurrency[0].pendingExpense).toBe('1500.00');
      expect(result.totalsByCurrency[0].paidExpense).toBe('0.00');
      expect(result.totalsByCurrency[1].currency).toBe('USD');
      expect(result.totalsByCurrency[1].paidIncome).toBe('95.00'); // paid_amount not expected_amount
      expect(result.totalsByCurrency[1].pendingIncome).toBe('0.00');
    });
  });

  // ─── payOccurrence ─────────────────────────────────────────────────────────

  describe('payOccurrence', () => {
    function setupPay(
      overrides: {
        ruleArchived?: boolean;
        ruleActive?: boolean;
        occStatus?: string;
        fundArchived?: boolean;
        allowNegativeBalance?: boolean;
        balance?: string;
      } = {},
    ) {
      const {
        ruleArchived = false,
        ruleActive = true,
        occStatus = 'PENDING',
        fundArchived = false,
        allowNegativeBalance = false,
        balance = '5000.00',
      } = overrides;

      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce({
        id: occId,
        ruleId,
        expectedAmount: { toString: () => '1500.00' },
        rule: { name: 'Alquiler', categoryId: catExpenseId },
      });
      prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(null); // no existing idempotency
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: ruleId }]) // lock rule
        .mockResolvedValueOnce([{ id: occId }]) // lock occurrence
        .mockResolvedValueOnce([{ id: fundId }]); // lock fund
      prismaMock.recurringOccurrence.findFirst
        .mockResolvedValueOnce(
          makeOccurrence({
            status: occStatus,
            rule: {
              id: ruleId,
              name: 'Alquiler',
              kind: 'EXPENSE',
              currency: 'PEN',
              frequency: 'MONTHLY',
              categoryId: catExpenseId,
              defaultFundId: fundId,
              isActive: ruleActive,
              isArchived: ruleArchived,
            },
          }),
        )
        .mockResolvedValueOnce(null); // post-lock idempotency check
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catExpenseId,
        kind: 'EXPENSE',
        isArchived: false,
      });
      prismaMock.fund.findFirst.mockResolvedValueOnce({
        id: fundId,
        currency: 'PEN',
        allowNegativeBalance,
        isArchived: fundArchived,
      });
      prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
        _sum: { signedAmount: { toString: () => balance } },
      });
    }

    it('pays EXPENSE occurrence with default amount', async () => {
      setupPay();
      prismaMock.financialTransaction.create.mockResolvedValueOnce({
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Alquiler',
        notes: null,
        categoryId: catExpenseId,
        relatedTransactionId: null,
        idempotencyKey: 'pay-1',
        createdAt: baseNow,
        updatedAt: baseNow,
      });
      prismaMock.fundEntry.create.mockResolvedValueOnce({
        id: 'entry-1',
        fundId,
        signedAmount: { toString: () => '-1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({
          status: 'PAID',
          paidTransactionId: txId,
          paidAmount: { toString: () => '1500.00' },
          paidAt: baseNow,
        }),
      );

      const result = await service.payOccurrence(contextA, {
        id: occId,
        fundId,
        idempotencyKey: 'pay-1',
      });

      expect(result.occurrence.status).toBe('PAID');
      expect(result.occurrence.paidAmount).toBe('1500.00');
      expect(result.fundBalanceAfter).toBe('3500.00');
    });

    it('pays with override amount', async () => {
      setupPay({ balance: '5000.00' });
      prismaMock.financialTransaction.create.mockResolvedValueOnce({
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '1900.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Alquiler Noviembre',
        notes: null,
        categoryId: catExpenseId,
        relatedTransactionId: null,
        idempotencyKey: 'pay-2',
        createdAt: baseNow,
        updatedAt: baseNow,
      });
      prismaMock.fundEntry.create.mockResolvedValueOnce({
        id: 'entry-2',
        fundId,
        signedAmount: { toString: () => '-1900.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({
          status: 'PAID',
          paidTransactionId: txId,
          paidAmount: { toString: () => '1900.00' },
          paidAt: baseNow,
        }),
      );

      const result = await service.payOccurrence(contextA, {
        id: occId,
        fundId,
        amount: '1900.00',
        description: 'Alquiler Noviembre',
        idempotencyKey: 'pay-2',
      });

      expect(result.occurrence.paidAmount).toBe('1900.00');
      expect(result.fundBalanceAfter).toBe('3100.00');
    });

    it('allows payment with paused rule (isActive=false, isArchived=false)', async () => {
      setupPay({ ruleActive: false });
      prismaMock.financialTransaction.create.mockResolvedValueOnce({
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Alquiler',
        notes: null,
        categoryId: catExpenseId,
        relatedTransactionId: null,
        idempotencyKey: 'pay-paused',
        createdAt: baseNow,
        updatedAt: baseNow,
      });
      prismaMock.fundEntry.create.mockResolvedValueOnce({
        id: 'entry-3',
        fundId,
        signedAmount: { toString: () => '-1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({
          status: 'PAID',
          paidTransactionId: txId,
          paidAmount: { toString: () => '1500.00' },
          paidAt: baseNow,
        }),
      );

      const result = await service.payOccurrence(contextA, {
        id: occId,
        fundId,
        idempotencyKey: 'pay-paused',
      });
      expect(result.occurrence.status).toBe('PAID');
    });

    it('rejects with 409 when rule is archived', async () => {
      setupPay({ ruleArchived: true });
      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-arch' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('rejects with 409 when occurrence is already PAID', async () => {
      setupPay({ occStatus: 'PAID' });
      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-paid' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('rejects with 409 when occurrence is SKIPPED', async () => {
      setupPay({ occStatus: 'SKIPPED' });
      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-skip' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('rejects with 409 when fund is archived', async () => {
      setupPay({ fundArchived: true });
      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-farc' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('rejects with 409 on insufficient balance when allowNegativeBalance=false', async () => {
      setupPay({ balance: '100.00', allowNegativeBalance: false });
      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-insuf' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('allows overdraft when allowNegativeBalance=true', async () => {
      setupPay({ balance: '100.00', allowNegativeBalance: true });
      prismaMock.financialTransaction.create.mockResolvedValueOnce({
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Alquiler',
        notes: null,
        categoryId: catExpenseId,
        relatedTransactionId: null,
        idempotencyKey: 'pay-neg',
        createdAt: baseNow,
        updatedAt: baseNow,
      });
      prismaMock.fundEntry.create.mockResolvedValueOnce({
        id: 'entry-neg',
        fundId,
        signedAmount: { toString: () => '-1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({
          status: 'PAID',
          paidTransactionId: txId,
          paidAmount: { toString: () => '1500.00' },
          paidAt: baseNow,
        }),
      );

      const result = await service.payOccurrence(contextA, {
        id: occId,
        fundId,
        idempotencyKey: 'pay-neg',
      });
      expect(result.fundBalanceAfter).toBe('-1400.00');
    });

    it('returns 404 for cross-user occurrence', async () => {
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-cross' }),
      ).rejects.toMatchObject({ error: { statusCode: 404 } });
    });

    it('idempotent: returns 201 for same payload re-attempt', async () => {
      // existing tx found pre-lock
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce({
        id: occId,
        ruleId,
        expectedAmount: { toString: () => '1500.00' },
        rule: { name: 'Alquiler', categoryId: catExpenseId },
      });
      const existingTx = {
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Alquiler',
        notes: null,
        categoryId: catExpenseId,
        relatedTransactionId: null,
        idempotencyKey: 'pay-idem',
        createdAt: baseNow,
        updatedAt: baseNow,
        fundEntries: [
          {
            id: 'entry-1',
            fundId,
            signedAmount: { toString: () => '-1500.00' },
            currency: 'PEN',
            occurredOn: limaDate,
            createdAt: baseNow,
          },
        ],
      };
      prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(existingTx);
      // linked occurrence
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce(
        makeOccurrence({
          status: 'PAID',
          paidTransactionId: txId,
          paidAmount: { toString: () => '1500.00' },
          paidAt: baseNow,
        }),
      );
      prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
        _sum: { signedAmount: { toString: () => '3500.00' } },
      });

      const result = await service.payOccurrence(contextA, {
        id: occId,
        fundId,
        idempotencyKey: 'pay-idem',
        occurredOn: '2026-11-26',
      });
      expect(result.occurrence.status).toBe('PAID');
      expect(result.fundBalanceAfter).toBe('3500.00');
      expect(prismaMock.financialTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects 409 if idempotency key was used by voided transaction', async () => {
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce({
        id: occId,
        ruleId,
        expectedAmount: { toString: () => '1500.00' },
        rule: { name: 'Alquiler', categoryId: catExpenseId },
      });
      prismaMock.financialTransaction.findFirst.mockResolvedValueOnce({
        id: txId,
        status: 'VOIDED',
        fundEntries: [],
      });

      await expect(
        service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'pay-voided' }),
      ).rejects.toMatchObject({ error: { statusCode: 409 } });
    });

    it('DAG lock order: rules locked before occurrences, occurrences before funds', async () => {
      const lockOrder: string[] = [];
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce({
        id: occId,
        ruleId,
        expectedAmount: { toString: () => '1500.00' },
        rule: { name: 'Alquiler', categoryId: catExpenseId },
      });
      prismaMock.financialTransaction.findFirst.mockResolvedValueOnce(null);
      prismaMock.$queryRaw
        .mockImplementationOnce(() => {
          lockOrder.push('rules');
          return Promise.resolve([{ id: ruleId }]);
        })
        .mockImplementationOnce(() => {
          lockOrder.push('occurrences');
          return Promise.resolve([{ id: occId }]);
        })
        .mockImplementationOnce(() => {
          lockOrder.push('funds');
          return Promise.resolve([{ id: fundId }]);
        });
      prismaMock.recurringOccurrence.findFirst
        .mockResolvedValueOnce(makeOccurrence())
        .mockResolvedValueOnce(null);
      prismaMock.category.findFirst.mockResolvedValueOnce({
        id: catExpenseId,
        kind: 'EXPENSE',
        isArchived: false,
      });
      prismaMock.fund.findFirst.mockResolvedValueOnce({
        id: fundId,
        currency: 'PEN',
        allowNegativeBalance: false,
        isArchived: false,
      });
      prismaMock.fundEntry.aggregate.mockResolvedValueOnce({
        _sum: { signedAmount: { toString: () => '5000.00' } },
      });
      prismaMock.financialTransaction.create.mockResolvedValueOnce({
        id: txId,
        type: 'EXPENSE',
        status: 'POSTED',
        amount: { toString: () => '1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        recordedAt: baseNow,
        description: 'Alquiler',
        notes: null,
        categoryId: catExpenseId,
        relatedTransactionId: null,
        idempotencyKey: 'dag-test',
        createdAt: baseNow,
        updatedAt: baseNow,
      });
      prismaMock.fundEntry.create.mockResolvedValueOnce({
        id: 'entry-dag',
        fundId,
        signedAmount: { toString: () => '-1500.00' },
        currency: 'PEN',
        occurredOn: limaDate,
        createdAt: baseNow,
      });
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({
          status: 'PAID',
          paidTransactionId: txId,
          paidAmount: { toString: () => '1500.00' },
          paidAt: baseNow,
        }),
      );

      await service.payOccurrence(contextA, { id: occId, fundId, idempotencyKey: 'dag-test' });
      expect(lockOrder).toEqual(['rules', 'occurrences', 'funds']);
    });
  });

  // ─── skipOccurrence / unskipOccurrence ───────────────────────────────────

  describe('skipOccurrence', () => {
    function setupSkip(status = 'PENDING', archived = false) {
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce({ id: occId, ruleId });
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: ruleId }])
        .mockResolvedValueOnce([{ id: occId }]);
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce(
        makeOccurrence({ status, rule: { ...makeOccurrence().rule, isArchived: archived } }),
      );
    }

    it('skips PENDING occurrence', async () => {
      setupSkip('PENDING');
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({ status: 'SKIPPED', skippedAt: baseNow }),
      );
      const result = await service.skipOccurrence(contextA, { id: occId });
      expect(result.occurrence.status).toBe('SKIPPED');
    });

    it('rejects 409 when already SKIPPED', async () => {
      setupSkip('SKIPPED');
      await expect(service.skipOccurrence(contextA, { id: occId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });

    it('rejects 409 when PAID', async () => {
      setupSkip('PAID');
      await expect(service.skipOccurrence(contextA, { id: occId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });

    it('rejects 409 when rule is archived', async () => {
      setupSkip('PENDING', true);
      await expect(service.skipOccurrence(contextA, { id: occId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });
  });

  describe('unskipOccurrence', () => {
    function setupUnskip(status = 'SKIPPED', archived = false) {
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce({ id: occId, ruleId });
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: ruleId }])
        .mockResolvedValueOnce([{ id: occId }]);
      prismaMock.recurringOccurrence.findFirst.mockResolvedValueOnce(
        makeOccurrence({
          status,
          skippedAt: status === 'SKIPPED' ? baseNow : null,
          rule: { ...makeOccurrence().rule, isArchived: archived },
        }),
      );
    }

    it('unskips SKIPPED occurrence -> PENDING', async () => {
      setupUnskip('SKIPPED');
      prismaMock.recurringOccurrence.update.mockResolvedValueOnce(
        makeOccurrence({ status: 'PENDING', skippedAt: null }),
      );
      const result = await service.unskipOccurrence(contextA, { id: occId });
      expect(result.occurrence.status).toBe('PENDING');
    });

    it('rejects 409 when already PENDING', async () => {
      setupUnskip('PENDING');
      await expect(service.unskipOccurrence(contextA, { id: occId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });

    it('rejects 409 when PAID', async () => {
      setupUnskip('PAID');
      await expect(service.unskipOccurrence(contextA, { id: occId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });

    it('rejects 409 when rule is archived', async () => {
      setupUnskip('SKIPPED', true);
      await expect(service.unskipOccurrence(contextA, { id: occId })).rejects.toMatchObject({
        error: { statusCode: 409 },
      });
    });
  });
});
