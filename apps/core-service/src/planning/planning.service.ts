import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  addDaysToIsoDate,
  addMoney,
  ArchiveRecurringRuleResponse,
  CategoryKindUnion,
  CreateRecurringRuleResponse,
  CreateRecurringRuleTcpPayload,
  extractDayOfMonth,
  formatMoney,
  FundCurrencyCode,
  FundEntryView,
  generateOccurrenceDatesInWindow,
  GetRecurringRuleByIdTcpPayload,
  GetRecurringRuleResponse,
  getLimaToday,
  InternalAuthContext,
  isValidGregorianDate,
  ListRecurringOccurrencesResponse,
  ListRecurringOccurrencesTcpPayload,
  ListRecurringRulesResponse,
  ListRecurringRulesTcpPayload,
  OccurrenceLifecycleTcpPayload,
  OccurrenceStatusResponse,
  parseMoney,
  PayRecurringOccurrenceResponse,
  PayRecurringOccurrenceTcpPayload,
  RECURRING_HORIZON_DAYS,
  RecurringCurrencyTotalsView,
  RecurringFrequencyValue,
  RecurringOccurrenceStatusValue,
  RecurringOccurrenceView,
  RecurringRuleView,
  RuleLifecycleTcpPayload,
  subMoney,
  TransactionDetailView,
  UpdateRecurringRuleResponse,
  UpdateRecurringRuleTcpPayload,
} from '@app/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_DECIMAL_14_2 = '999999999999.99';
const POSITIVE_MONEY_REGEX = /^\d{1,12}(\.\d{1,2})?$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RULE_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_NOTES_LENGTH = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

const VALID_KINDS: readonly CategoryKindUnion[] = ['INCOME', 'EXPENSE'];
const VALID_CURRENCIES: readonly FundCurrencyCode[] = ['PEN', 'USD'];
const VALID_FREQUENCIES: readonly RecurringFrequencyValue[] = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'YEARLY',
];
const VALID_OCCURRENCE_STATUSES: readonly RecurringOccurrenceStatusValue[] = [
  'PENDING',
  'PAID',
  'SKIPPED',
];
const CURRENCY_ORDER: Record<FundCurrencyCode, number> = { PEN: 0, USD: 1 };

interface DecimalLike {
  toString(): string;
}

interface RecurringRuleDbProjection {
  id: string;
  userId: string;
  name: string;
  kind: CategoryKindUnion;
  amount: DecimalLike;
  currency: FundCurrencyCode;
  frequency: RecurringFrequencyValue;
  startDate: Date;
  endDate: Date | null;
  anchorDay: number;
  categoryId: string;
  defaultFundId: string | null;
  notes: string | null;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RecurringOccurrenceWithRuleDbProjection {
  id: string;
  userId: string;
  ruleId: string;
  scheduledDate: Date;
  expectedAmount: DecimalLike;
  currency: FundCurrencyCode;
  status: RecurringOccurrenceStatusValue;
  paidTransactionId: string | null;
  paidAmount: DecimalLike | null;
  paidAt: Date | null;
  skippedAt: Date | null;
  lastVoidedTransactionId: string | null;
  lastVoidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rule: {
    id: string;
    name: string;
    kind: CategoryKindUnion;
    currency: FundCurrencyCode;
    frequency: RecurringFrequencyValue;
    categoryId: string;
    defaultFundId: string | null;
    isActive: boolean;
    isArchived: boolean;
  };
}

interface FundEntryDbProjection {
  id: string;
  fundId: string;
  signedAmount: DecimalLike;
  currency: FundCurrencyCode;
  occurredOn: Date;
  createdAt: Date;
}

interface TransactionDbProjection {
  id: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'ADJUSTMENT' | 'VOID' | 'REFUND';
  status: 'POSTED' | 'VOIDED';
  amount: DecimalLike;
  currency: FundCurrencyCode;
  occurredOn: Date;
  recordedAt: Date;
  description: string;
  notes: string | null;
  categoryId: string | null;
  relatedTransactionId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  fundEntries: FundEntryDbProjection[];
}

function buildBadRequestRpc(message: string): RpcException {
  return new RpcException({ statusCode: 400, error: 'Bad Request', message });
}

function buildUnauthorizedRpc(message: string): RpcException {
  return new RpcException({ statusCode: 401, error: 'Unauthorized', message });
}

function buildNotFoundRpc(message: string): RpcException {
  return new RpcException({ statusCode: 404, error: 'Not Found', message });
}

function buildConflictRpc(message: string): RpcException {
  return new RpcException({ statusCode: 409, error: 'Conflict', message });
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function requireAuthenticatedUserId(context: InternalAuthContext): string {
  if (typeof context.userId !== 'string' || context.userId.trim().length === 0) {
    throw buildUnauthorizedRpc('Authenticated user context is required');
  }
  return context.userId;
}

function requireUuid(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || !UUID_REGEX.test(raw.trim())) {
    throw buildBadRequestRpc(`${fieldName} must be a valid UUID`);
  }
  return raw.trim().toLowerCase();
}

function toLimaCalendarDateUtc(limaDateStr: string): Date {
  return new Date(`${limaDateStr}T00:00:00.000Z`);
}

function formatDbCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validateAndFormatPositiveAmount(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || !POSITIVE_MONEY_REGEX.test(raw)) {
    throw buildBadRequestRpc(
      `${fieldName} must be a positive decimal string with up to 2 decimal places`,
    );
  }

  let parsed;
  try {
    parsed = parseMoney(raw);
  } catch {
    throw buildBadRequestRpc(`Invalid ${fieldName}`);
  }

  if (parsed.lessThanOrEqualTo(0) || parsed.greaterThan(MAX_DECIMAL_14_2)) {
    throw buildBadRequestRpc(`${fieldName} must be greater than 0.00 and within allowed range`);
  }

  return formatMoney(parsed);
}

function normalizeRequiredText(raw: unknown, maxLength: number, fieldName: string): string {
  if (typeof raw !== 'string') {
    throw buildBadRequestRpc(`${fieldName} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw buildBadRequestRpc(`${fieldName} must be between 1 and ${maxLength} characters`);
  }
  return trimmed;
}

function normalizeOptionalNotes(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw buildBadRequestRpc('notes must be a string');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw buildBadRequestRpc(`notes cannot exceed ${MAX_NOTES_LENGTH} characters`);
  }
  return trimmed;
}

function requireGregorianDate(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || !isValidGregorianDate(raw)) {
    throw buildBadRequestRpc(
      `${fieldName} must be a valid Gregorian calendar date in YYYY-MM-DD format`,
    );
  }
  return raw;
}

function toRuleView(rule: RecurringRuleDbProjection): RecurringRuleView {
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    amount: formatMoney(rule.amount.toString()),
    currency: rule.currency,
    frequency: rule.frequency,
    startDate: formatDbCalendarDate(rule.startDate),
    endDate: rule.endDate ? formatDbCalendarDate(rule.endDate) : null,
    anchorDay: rule.anchorDay,
    categoryId: rule.categoryId,
    defaultFundId: rule.defaultFundId,
    notes: rule.notes,
    isActive: rule.isActive,
    isArchived: rule.isArchived,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function toOccurrenceView(
  occ: RecurringOccurrenceWithRuleDbProjection,
  todayLima: string,
): RecurringOccurrenceView {
  const scheduledDate = formatDbCalendarDate(occ.scheduledDate);
  return {
    id: occ.id,
    ruleId: occ.ruleId,
    ruleName: occ.rule.name,
    kind: occ.rule.kind,
    currency: occ.currency,
    frequency: occ.rule.frequency,
    categoryId: occ.rule.categoryId,
    defaultFundId: occ.rule.defaultFundId,
    ruleIsActive: occ.rule.isActive,
    ruleIsArchived: occ.rule.isArchived,
    scheduledDate,
    expectedAmount: formatMoney(occ.expectedAmount.toString()),
    status: occ.status,
    isOverdue: occ.status === 'PENDING' && scheduledDate < todayLima,
    paidTransactionId: occ.paidTransactionId,
    paidAmount: occ.paidAmount !== null ? formatMoney(occ.paidAmount.toString()) : null,
    paidAt: occ.paidAt ? occ.paidAt.toISOString() : null,
    skippedAt: occ.skippedAt ? occ.skippedAt.toISOString() : null,
    lastVoidedTransactionId: occ.lastVoidedTransactionId,
    lastVoidedAt: occ.lastVoidedAt ? occ.lastVoidedAt.toISOString() : null,
    createdAt: occ.createdAt.toISOString(),
    updatedAt: occ.updatedAt.toISOString(),
  };
}

function toFundEntryView(entry: FundEntryDbProjection): FundEntryView {
  return {
    id: entry.id,
    fundId: entry.fundId,
    signedAmount: formatMoney(entry.signedAmount.toString()),
    currency: entry.currency,
    occurredOn: formatDbCalendarDate(entry.occurredOn),
    createdAt: entry.createdAt.toISOString(),
  };
}

function toTransactionDetailView(txRecord: TransactionDbProjection): TransactionDetailView {
  return {
    id: txRecord.id,
    type: txRecord.type,
    status: txRecord.status,
    amount: formatMoney(txRecord.amount.toString()),
    currency: txRecord.currency,
    occurredOn: formatDbCalendarDate(txRecord.occurredOn),
    recordedAt: txRecord.recordedAt.toISOString(),
    description: txRecord.description,
    notes: txRecord.notes,
    categoryId: txRecord.categoryId,
    relatedTransactionId: txRecord.relatedTransactionId,
    idempotencyKey: txRecord.idempotencyKey,
    createdAt: txRecord.createdAt.toISOString(),
    updatedAt: txRecord.updatedAt.toISOString(),
    entries: txRecord.fundEntries.map(toFundEntryView),
    splits: [],
  };
}

function formatPrismaDecimalMoney(val: Prisma.Decimal): string {
  const rounded = val.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}

@Injectable()
export class PlanningService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateCategoryForRule(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    categoryId: string,
    expectedKind: CategoryKindUnion,
  ): Promise<void> {
    const category = await db.category.findFirst({
      where: {
        id: categoryId,
        OR: [{ userId }, { userId: null }],
      },
      select: {
        id: true,
        kind: true,
        isArchived: true,
      },
    });

    if (!category) {
      throw buildNotFoundRpc('Category not found');
    }

    if (category.isArchived) {
      throw buildConflictRpc('Cannot use an archived category');
    }

    if (category.kind !== expectedKind) {
      throw buildBadRequestRpc(`Category kind must be ${expectedKind}`);
    }
  }

  private async validateDefaultFundForRule(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    fundId: string,
    expectedCurrency: FundCurrencyCode,
  ): Promise<void> {
    const fund = await db.fund.findFirst({
      where: {
        id: fundId,
        userId,
      },
      select: {
        id: true,
        currency: true,
        isArchived: true,
      },
    });

    if (!fund) {
      throw buildNotFoundRpc('Default fund not found');
    }

    if (fund.isArchived) {
      throw buildConflictRpc('Cannot use an archived default fund');
    }

    if (fund.currency !== expectedCurrency) {
      throw buildBadRequestRpc(`Default fund currency must be ${expectedCurrency}`);
    }
  }

  private async materializeRuleOccurrencesInWindow(
    db: PrismaService | Prisma.TransactionClient,
    rule: {
      id: string;
      userId: string;
      frequency: RecurringFrequencyValue;
      startDate: Date;
      endDate: Date | null;
      anchorDay: number;
      amount: DecimalLike;
      currency: FundCurrencyCode;
      isActive: boolean;
      isArchived: boolean;
    },
    windowStart: string,
    windowEnd: string,
  ): Promise<number> {
    if (!rule.isActive || rule.isArchived) {
      return 0;
    }

    const dates = generateOccurrenceDatesInWindow({
      frequency: rule.frequency,
      startDate: formatDbCalendarDate(rule.startDate),
      endDate: rule.endDate ? formatDbCalendarDate(rule.endDate) : null,
      anchorDay: rule.anchorDay,
      windowStart,
      windowEnd,
    });

    if (dates.length === 0) {
      return 0;
    }

    const expectedAmount = formatMoney(rule.amount.toString());
    const result = await db.recurringOccurrence.createMany({
      data: dates.map((scheduledDate) => ({
        userId: rule.userId,
        ruleId: rule.id,
        scheduledDate: toLimaCalendarDateUtc(scheduledDate),
        expectedAmount,
        currency: rule.currency,
        status: 'PENDING',
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  private async getFundBalance(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    fundId: string,
  ): Promise<string> {
    const aggregate = await db.fundEntry.aggregate({
      where: { userId, fundId },
      _sum: { signedAmount: true },
    });

    const sum = aggregate._sum.signedAmount;
    return sum ? formatMoney(sum.toString()) : '0.00';
  }

  async createRule(
    context: InternalAuthContext,
    payload: CreateRecurringRuleTcpPayload,
  ): Promise<CreateRecurringRuleResponse> {
    const userId = requireAuthenticatedUserId(context);
    const name = normalizeRequiredText(payload.name, MAX_RULE_NAME_LENGTH, 'name');

    if (!VALID_KINDS.includes(payload.kind)) {
      throw buildBadRequestRpc('kind must be INCOME or EXPENSE');
    }
    if (!VALID_CURRENCIES.includes(payload.currency)) {
      throw buildBadRequestRpc('currency must be PEN or USD');
    }
    if (!VALID_FREQUENCIES.includes(payload.frequency)) {
      throw buildBadRequestRpc('frequency must be WEEKLY, BIWEEKLY, MONTHLY or YEARLY');
    }

    const amount = validateAndFormatPositiveAmount(payload.amount, 'amount');
    const startDateStr = requireGregorianDate(payload.startDate, 'startDate');
    const endDateStr =
      payload.endDate !== undefined ? requireGregorianDate(payload.endDate, 'endDate') : null;

    if (endDateStr !== null && endDateStr < startDateStr) {
      throw buildBadRequestRpc('endDate must be greater than or equal to startDate');
    }

    const categoryId = requireUuid(payload.categoryId, 'categoryId');
    const defaultFundId =
      payload.defaultFundId !== undefined
        ? requireUuid(payload.defaultFundId, 'defaultFundId')
        : null;
    const notes = normalizeOptionalNotes(payload.notes);
    const anchorDay = extractDayOfMonth(startDateStr);

    const horizonStart = getLimaToday();
    const horizonEnd = addDaysToIsoDate(horizonStart, RECURRING_HORIZON_DAYS);

    return this.prisma.$transaction(async (tx) => {
      await this.validateCategoryForRule(tx, userId, categoryId, payload.kind);
      if (defaultFundId !== null) {
        await this.validateDefaultFundForRule(tx, userId, defaultFundId, payload.currency);
      }

      const createdRule = await tx.recurringRule.create({
        data: {
          userId,
          name,
          kind: payload.kind,
          amount,
          currency: payload.currency,
          frequency: payload.frequency,
          startDate: toLimaCalendarDateUtc(startDateStr),
          endDate: endDateStr !== null ? toLimaCalendarDateUtc(endDateStr) : null,
          anchorDay,
          categoryId,
          defaultFundId,
          notes,
          isActive: true,
          isArchived: false,
        },
      });

      const materializedCount = await this.materializeRuleOccurrencesInWindow(
        tx,
        createdRule,
        horizonStart,
        horizonEnd,
      );

      return {
        rule: toRuleView(createdRule),
        materializedCount,
      };
    });
  }

  async listRules(
    context: InternalAuthContext,
    payload: ListRecurringRulesTcpPayload,
  ): Promise<ListRecurringRulesResponse> {
    const userId = requireAuthenticatedUserId(context);

    if (payload.kind !== undefined && !VALID_KINDS.includes(payload.kind)) {
      throw buildBadRequestRpc('kind must be INCOME or EXPENSE');
    }
    if (payload.currency !== undefined && !VALID_CURRENCIES.includes(payload.currency)) {
      throw buildBadRequestRpc('currency must be PEN or USD');
    }
    if (payload.frequency !== undefined && !VALID_FREQUENCIES.includes(payload.frequency)) {
      throw buildBadRequestRpc('frequency must be WEEKLY, BIWEEKLY, MONTHLY or YEARLY');
    }

    const includeArchived = payload.includeArchived === true;

    const rules = await this.prisma.recurringRule.findMany({
      where: {
        userId,
        ...(includeArchived ? {} : { isArchived: false }),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
        ...(payload.currency !== undefined ? { currency: payload.currency } : {}),
        ...(payload.frequency !== undefined ? { frequency: payload.frequency } : {}),
      },
      orderBy: [{ isArchived: 'asc' }, { isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      rules: rules.map(toRuleView),
    };
  }

  async getRuleById(
    context: InternalAuthContext,
    payload: GetRecurringRuleByIdTcpPayload,
  ): Promise<GetRecurringRuleResponse> {
    const userId = requireAuthenticatedUserId(context);
    const id = requireUuid(payload.id, 'id');

    const rule = await this.prisma.recurringRule.findFirst({
      where: { id, userId },
    });

    if (!rule) {
      throw buildNotFoundRpc('Recurring rule not found');
    }

    return { rule: toRuleView(rule) };
  }

  async updateRule(
    context: InternalAuthContext,
    payload: UpdateRecurringRuleTcpPayload,
  ): Promise<UpdateRecurringRuleResponse> {
    const userId = requireAuthenticatedUserId(context);
    const id = requireUuid(payload.id, 'id');

    const hasUpdatableField =
      payload.name !== undefined ||
      payload.amount !== undefined ||
      payload.frequency !== undefined ||
      payload.startDate !== undefined ||
      payload.endDate !== undefined ||
      payload.categoryId !== undefined ||
      payload.defaultFundId !== undefined ||
      payload.notes !== undefined;

    if (!hasUpdatableField) {
      throw buildBadRequestRpc('At least one updatable field must be provided');
    }

    const nextName =
      payload.name !== undefined
        ? normalizeRequiredText(payload.name, MAX_RULE_NAME_LENGTH, 'name')
        : undefined;
    const nextAmount =
      payload.amount !== undefined
        ? validateAndFormatPositiveAmount(payload.amount, 'amount')
        : undefined;

    if (payload.frequency !== undefined && !VALID_FREQUENCIES.includes(payload.frequency)) {
      throw buildBadRequestRpc('frequency must be WEEKLY, BIWEEKLY, MONTHLY or YEARLY');
    }

    const nextStartDateStr =
      payload.startDate !== undefined
        ? requireGregorianDate(payload.startDate, 'startDate')
        : undefined;

    let nextEndDateStr: string | null | undefined;
    if (payload.endDate !== undefined) {
      nextEndDateStr =
        payload.endDate === null ? null : requireGregorianDate(payload.endDate, 'endDate');
    }

    const nextCategoryId =
      payload.categoryId !== undefined ? requireUuid(payload.categoryId, 'categoryId') : undefined;

    let nextDefaultFundId: string | null | undefined;
    if (payload.defaultFundId !== undefined) {
      nextDefaultFundId =
        payload.defaultFundId === null ? null : requireUuid(payload.defaultFundId, 'defaultFundId');
    }

    const nextNotes =
      payload.notes !== undefined ? normalizeOptionalNotes(payload.notes) : undefined;

    const horizonStart = getLimaToday();
    const horizonEnd = addDaysToIsoDate(horizonStart, RECURRING_HORIZON_DAYS);
    const todayDateUtc = toLimaCalendarDateUtc(horizonStart);

    return this.prisma.$transaction(async (tx) => {
      // Lock level (2) recurring_rules
      const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_rules
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;

      if (lockedRules.length === 0) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      const existing = await tx.recurringRule.findFirst({
        where: { id, userId },
      });

      if (!existing) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      if (existing.isArchived) {
        throw buildConflictRpc('Cannot update an archived recurring rule');
      }

      const effectiveStartDateStr = nextStartDateStr ?? formatDbCalendarDate(existing.startDate);
      const effectiveEndDateStr =
        nextEndDateStr !== undefined
          ? nextEndDateStr
          : existing.endDate
            ? formatDbCalendarDate(existing.endDate)
            : null;

      if (effectiveEndDateStr !== null && effectiveEndDateStr < effectiveStartDateStr) {
        throw buildBadRequestRpc('endDate must be greater than or equal to startDate');
      }

      if (nextCategoryId !== undefined) {
        await this.validateCategoryForRule(tx, userId, nextCategoryId, existing.kind);
      }

      if (nextDefaultFundId !== undefined && nextDefaultFundId !== null) {
        await this.validateDefaultFundForRule(tx, userId, nextDefaultFundId, existing.currency);
      }

      const scheduleChanged =
        (payload.frequency !== undefined && payload.frequency !== existing.frequency) ||
        (nextStartDateStr !== undefined &&
          nextStartDateStr !== formatDbCalendarDate(existing.startDate)) ||
        (nextEndDateStr !== undefined &&
          nextEndDateStr !== (existing.endDate ? formatDbCalendarDate(existing.endDate) : null));

      const amountChanged =
        nextAmount !== undefined && nextAmount !== formatMoney(existing.amount.toString());

      const updatedRule = await tx.recurringRule.update({
        where: { id: existing.id },
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(nextAmount !== undefined ? { amount: nextAmount } : {}),
          ...(payload.frequency !== undefined ? { frequency: payload.frequency } : {}),
          ...(nextStartDateStr !== undefined
            ? {
                startDate: toLimaCalendarDateUtc(nextStartDateStr),
                anchorDay: extractDayOfMonth(nextStartDateStr),
              }
            : {}),
          ...(nextEndDateStr !== undefined
            ? { endDate: nextEndDateStr !== null ? toLimaCalendarDateUtc(nextEndDateStr) : null }
            : {}),
          ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
          ...(nextDefaultFundId !== undefined ? { defaultFundId: nextDefaultFundId } : {}),
          ...(nextNotes !== undefined ? { notes: nextNotes } : {}),
        },
      });

      if (scheduleChanged) {
        // Lock level (3) recurring_occurrences: preserve PAID, SKIPPED and overdue (< hoy_Lima)
        await tx.$queryRaw`
          SELECT id
          FROM public.recurring_occurrences
          WHERE rule_id = ${existing.id}::uuid
            AND user_id = ${userId}::uuid
            AND status = 'PENDING'
            AND scheduled_date >= ${todayDateUtc}::date
          FOR UPDATE
        `;

        await tx.recurringOccurrence.deleteMany({
          where: {
            ruleId: existing.id,
            userId,
            status: 'PENDING',
            scheduledDate: { gte: todayDateUtc },
          },
        });

        await this.materializeRuleOccurrencesInWindow(tx, updatedRule, horizonStart, horizonEnd);
      } else if (amountChanged && nextAmount !== undefined) {
        await tx.$queryRaw`
          SELECT id
          FROM public.recurring_occurrences
          WHERE rule_id = ${existing.id}::uuid
            AND user_id = ${userId}::uuid
            AND status = 'PENDING'
            AND scheduled_date >= ${todayDateUtc}::date
          FOR UPDATE
        `;

        await tx.recurringOccurrence.updateMany({
          where: {
            ruleId: existing.id,
            userId,
            status: 'PENDING',
            scheduledDate: { gte: todayDateUtc },
          },
          data: {
            expectedAmount: nextAmount,
          },
        });
      }

      return { rule: toRuleView(updatedRule) };
    });
  }

  async pauseRule(
    context: InternalAuthContext,
    payload: RuleLifecycleTcpPayload,
  ): Promise<GetRecurringRuleResponse> {
    const userId = requireAuthenticatedUserId(context);
    const id = requireUuid(payload.id, 'id');

    return this.prisma.$transaction(async (tx) => {
      const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_rules
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;

      if (lockedRules.length === 0) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      const existing = await tx.recurringRule.findFirst({ where: { id, userId } });
      if (!existing) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      if (existing.isArchived) {
        throw buildConflictRpc('Cannot pause an archived recurring rule');
      }

      if (!existing.isActive) {
        return { rule: toRuleView(existing) };
      }

      const updated = await tx.recurringRule.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      return { rule: toRuleView(updated) };
    });
  }

  async resumeRule(
    context: InternalAuthContext,
    payload: RuleLifecycleTcpPayload,
  ): Promise<GetRecurringRuleResponse> {
    const userId = requireAuthenticatedUserId(context);
    const id = requireUuid(payload.id, 'id');
    const horizonStart = getLimaToday();
    const horizonEnd = addDaysToIsoDate(horizonStart, RECURRING_HORIZON_DAYS);

    return this.prisma.$transaction(async (tx) => {
      const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_rules
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;

      if (lockedRules.length === 0) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      const existing = await tx.recurringRule.findFirst({ where: { id, userId } });
      if (!existing) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      if (existing.isArchived) {
        throw buildConflictRpc('Cannot resume an archived recurring rule');
      }

      const updated = existing.isActive
        ? existing
        : await tx.recurringRule.update({
            where: { id: existing.id },
            data: { isActive: true },
          });

      await this.materializeRuleOccurrencesInWindow(tx, updated, horizonStart, horizonEnd);

      return { rule: toRuleView(updated) };
    });
  }

  async archiveRule(
    context: InternalAuthContext,
    payload: RuleLifecycleTcpPayload,
  ): Promise<ArchiveRecurringRuleResponse> {
    const userId = requireAuthenticatedUserId(context);
    const id = requireUuid(payload.id, 'id');
    const todayDateUtc = toLimaCalendarDateUtc(getLimaToday());

    return this.prisma.$transaction(async (tx) => {
      const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_rules
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;

      if (lockedRules.length === 0) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      const existing = await tx.recurringRule.findFirst({ where: { id, userId } });
      if (!existing) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      if (existing.isArchived) {
        throw buildConflictRpc('Recurring rule is already archived');
      }

      // Lock level (3) recurring_occurrences before deleting future PENDING
      await tx.$queryRaw`
        SELECT id
        FROM public.recurring_occurrences
        WHERE rule_id = ${existing.id}::uuid
          AND user_id = ${userId}::uuid
          AND status = 'PENDING'
          AND scheduled_date >= ${todayDateUtc}::date
        FOR UPDATE
      `;

      const deleted = await tx.recurringOccurrence.deleteMany({
        where: {
          ruleId: existing.id,
          userId,
          status: 'PENDING',
          scheduledDate: { gte: todayDateUtc },
        },
      });

      const archived = await tx.recurringRule.update({
        where: { id: existing.id },
        data: {
          isArchived: true,
          isActive: false,
        },
      });

      return {
        rule: toRuleView(archived),
        deletedPendingCount: deleted.count,
      };
    });
  }

  async listOccurrences(
    context: InternalAuthContext,
    payload: ListRecurringOccurrencesTcpPayload,
  ): Promise<ListRecurringOccurrencesResponse> {
    const userId = requireAuthenticatedUserId(context);

    const fromDate =
      payload.fromDate !== undefined
        ? requireGregorianDate(payload.fromDate, 'fromDate')
        : undefined;
    const toDate =
      payload.toDate !== undefined ? requireGregorianDate(payload.toDate, 'toDate') : undefined;

    if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
      throw buildBadRequestRpc('fromDate must be less than or equal to toDate');
    }

    if (payload.status !== undefined && !VALID_OCCURRENCE_STATUSES.includes(payload.status)) {
      throw buildBadRequestRpc('status must be PENDING, PAID or SKIPPED');
    }

    if (payload.currency !== undefined && !VALID_CURRENCIES.includes(payload.currency)) {
      throw buildBadRequestRpc('currency must be PEN or USD');
    }

    if (payload.kind !== undefined && !VALID_KINDS.includes(payload.kind)) {
      throw buildBadRequestRpc('kind must be INCOME or EXPENSE');
    }

    const ruleId = payload.ruleId !== undefined ? requireUuid(payload.ruleId, 'ruleId') : undefined;

    const horizonStart = getLimaToday();
    const horizonEnd = addDaysToIsoDate(horizonStart, RECURRING_HORIZON_DAYS);

    // Materialize active rules into [hoy_Lima, hoy_Lima + 60d]
    const activeRules = await this.prisma.recurringRule.findMany({
      where: {
        userId,
        isActive: true,
        isArchived: false,
        ...(ruleId !== undefined ? { id: ruleId } : {}),
      },
    });

    for (const rule of activeRules) {
      await this.materializeRuleOccurrencesInWindow(this.prisma, rule, horizonStart, horizonEnd);
    }

    const horizonStartDateUtc = toLimaCalendarDateUtc(horizonStart);
    const effectiveToDateStr = toDate ?? horizonEnd;
    const effectiveToDateUtc = toLimaCalendarDateUtc(effectiveToDateStr);

    let dateFilter: Prisma.RecurringOccurrenceWhereInput;
    if (fromDate !== undefined) {
      dateFilter = {
        scheduledDate: {
          gte: toLimaCalendarDateUtc(fromDate),
          ...(toDate !== undefined ? { lte: toLimaCalendarDateUtc(toDate) } : {}),
        },
      };
    } else {
      dateFilter = {
        OR: [
          {
            status: 'PENDING',
            scheduledDate: { lt: horizonStartDateUtc },
          },
          {
            scheduledDate: {
              gte: horizonStartDateUtc,
              lte: effectiveToDateUtc,
            },
          },
        ],
      };
    }

    const occurrences = await this.prisma.recurringOccurrence.findMany({
      where: {
        userId,
        ...dateFilter,
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.currency !== undefined ? { currency: payload.currency } : {}),
        ...(ruleId !== undefined ? { ruleId } : {}),
        ...(payload.kind !== undefined ? { rule: { kind: payload.kind } } : {}),
      },
      include: {
        rule: {
          select: {
            id: true,
            name: true,
            kind: true,
            currency: true,
            frequency: true,
            categoryId: true,
            defaultFundId: true,
            isActive: true,
            isArchived: true,
          },
        },
      },
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    });

    const views = occurrences.map((occ) => toOccurrenceView(occ, horizonStart));

    // Compute totalsByCurrency using Prisma.Decimal, ordered PEN then USD
    const totalsMap = new Map<
      FundCurrencyCode,
      {
        pendingIncome: Prisma.Decimal;
        pendingExpense: Prisma.Decimal;
        paidIncome: Prisma.Decimal;
        paidExpense: Prisma.Decimal;
        pendingCount: number;
        overdueCount: number;
      }
    >();

    for (const occ of views) {
      let bucket = totalsMap.get(occ.currency);
      if (!bucket) {
        bucket = {
          pendingIncome: new Prisma.Decimal(0),
          pendingExpense: new Prisma.Decimal(0),
          paidIncome: new Prisma.Decimal(0),
          paidExpense: new Prisma.Decimal(0),
          pendingCount: 0,
          overdueCount: 0,
        };
        totalsMap.set(occ.currency, bucket);
      }

      if (occ.status === 'PENDING') {
        const expected = new Prisma.Decimal(occ.expectedAmount);
        if (occ.kind === 'INCOME') {
          bucket.pendingIncome = bucket.pendingIncome.plus(expected);
        } else {
          bucket.pendingExpense = bucket.pendingExpense.plus(expected);
        }
        bucket.pendingCount += 1;
        if (occ.isOverdue) {
          bucket.overdueCount += 1;
        }
      } else if (occ.status === 'PAID' && occ.paidAmount !== null) {
        const paid = new Prisma.Decimal(occ.paidAmount);
        if (occ.kind === 'INCOME') {
          bucket.paidIncome = bucket.paidIncome.plus(paid);
        } else {
          bucket.paidExpense = bucket.paidExpense.plus(paid);
        }
      }
    }

    const totalsByCurrency: RecurringCurrencyTotalsView[] = Array.from(totalsMap.entries())
      .sort(([left], [right]) => CURRENCY_ORDER[left] - CURRENCY_ORDER[right])
      .map(([currency, bucket]) => ({
        currency,
        pendingIncome: formatPrismaDecimalMoney(bucket.pendingIncome),
        pendingExpense: formatPrismaDecimalMoney(bucket.pendingExpense),
        paidIncome: formatPrismaDecimalMoney(bucket.paidIncome),
        paidExpense: formatPrismaDecimalMoney(bucket.paidExpense),
        pendingCount: bucket.pendingCount,
        overdueCount: bucket.overdueCount,
      }));

    return {
      horizonStart,
      horizonEnd,
      occurrences: views,
      totalsByCurrency,
    };
  }

  private async findTransactionByIdempotencyKey(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<TransactionDbProjection | null> {
    return db.financialTransaction.findFirst({
      where: { userId, idempotencyKey },
      include: {
        fundEntries: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
  }

  private async resolveIdempotentPayResponse(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    targetOccurrenceId: string,
    existingTx: TransactionDbProjection,
    expectedParams: {
      fundId: string;
      resolvedAmount: string;
      occurredOn: string;
      resolvedDescription: string;
      notes: string | null;
      categoryId: string;
    },
    todayLima: string,
  ): Promise<PayRecurringOccurrenceResponse> {
    if (existingTx.status === 'VOIDED') {
      throw buildConflictRpc('Idempotency key already used by a voided transaction');
    }

    const linkedOccurrence = await db.recurringOccurrence.findFirst({
      where: {
        paidTransactionId: existingTx.id,
        userId,
      },
      include: {
        rule: {
          select: {
            id: true,
            name: true,
            kind: true,
            currency: true,
            frequency: true,
            categoryId: true,
            defaultFundId: true,
            isActive: true,
            isArchived: true,
          },
        },
      },
    });

    if (!linkedOccurrence || linkedOccurrence.id.toLowerCase() !== targetOccurrenceId) {
      throw buildConflictRpc('Idempotency key already used with different request parameters');
    }

    const existingFundId = existingTx.fundEntries[0]?.fundId.toLowerCase();
    if (
      existingFundId !== expectedParams.fundId ||
      formatMoney(existingTx.amount.toString()) !== expectedParams.resolvedAmount ||
      formatDbCalendarDate(existingTx.occurredOn) !== expectedParams.occurredOn ||
      existingTx.description !== expectedParams.resolvedDescription ||
      (existingTx.notes ?? null) !== expectedParams.notes ||
      (existingTx.categoryId?.toLowerCase() ?? null) !== expectedParams.categoryId.toLowerCase()
    ) {
      throw buildConflictRpc('Idempotency key already used with different request parameters');
    }

    const fundBalanceAfter = await this.getFundBalance(db, userId, expectedParams.fundId);

    return {
      occurrence: toOccurrenceView(linkedOccurrence, todayLima),
      transaction: toTransactionDetailView(existingTx),
      fundBalanceAfter,
    };
  }

  async payOccurrence(
    context: InternalAuthContext,
    payload: PayRecurringOccurrenceTcpPayload,
  ): Promise<PayRecurringOccurrenceResponse> {
    const userId = requireAuthenticatedUserId(context);
    const occurrenceId = requireUuid(payload.id, 'id');
    const fundId = requireUuid(payload.fundId, 'fundId');

    if (typeof payload.idempotencyKey !== 'string') {
      throw buildBadRequestRpc('Idempotency-Key header is required');
    }
    const idempotencyKey = payload.idempotencyKey.trim();
    if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw buildBadRequestRpc(
        `Idempotency-Key must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }

    const todayLima = getLimaToday();
    const overrideAmount =
      payload.amount !== undefined
        ? validateAndFormatPositiveAmount(payload.amount, 'amount')
        : undefined;
    const occurredOn =
      payload.occurredOn !== undefined
        ? requireGregorianDate(payload.occurredOn, 'occurredOn')
        : todayLima;
    const overrideDescription =
      payload.description !== undefined
        ? normalizeRequiredText(payload.description, MAX_DESCRIPTION_LENGTH, 'description')
        : undefined;
    const notes = normalizeOptionalNotes(payload.notes);
    const occurredOnDateUtc = toLimaCalendarDateUtc(occurredOn);

    // Read immutable rule_id of target occurrence without lock for DAG ordering (2 -> 3 -> 4)
    const occMeta = await this.prisma.recurringOccurrence.findFirst({
      where: { id: occurrenceId, userId },
      select: {
        id: true,
        ruleId: true,
        expectedAmount: true,
        rule: {
          select: {
            name: true,
            categoryId: true,
          },
        },
      },
    });

    if (!occMeta) {
      throw buildNotFoundRpc('Recurring occurrence not found');
    }

    const resolvedAmountInitial = overrideAmount ?? formatMoney(occMeta.expectedAmount.toString());
    const resolvedDescriptionInitial =
      overrideDescription ?? occMeta.rule.name.slice(0, MAX_DESCRIPTION_LENGTH);

    // Pre-lock idempotency fast-path
    const preLockExisting = await this.findTransactionByIdempotencyKey(
      this.prisma,
      userId,
      idempotencyKey,
    );
    if (preLockExisting) {
      return this.resolveIdempotentPayResponse(
        this.prisma,
        userId,
        occurrenceId,
        preLockExisting,
        {
          fundId,
          resolvedAmount: resolvedAmountInitial,
          occurredOn,
          resolvedDescription: resolvedDescriptionInitial,
          notes,
          categoryId: occMeta.rule.categoryId,
        },
        todayLima,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // DAG Level (2): recurring_rules FOR UPDATE
        const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.recurring_rules
          WHERE id = ${occMeta.ruleId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE
        `;

        if (lockedRules.length === 0) {
          throw buildNotFoundRpc('Recurring rule not found');
        }

        // DAG Level (3): recurring_occurrences FOR UPDATE
        const lockedOccurrences = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.recurring_occurrences
          WHERE id = ${occurrenceId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE
        `;

        if (lockedOccurrences.length === 0) {
          throw buildNotFoundRpc('Recurring occurrence not found');
        }

        const occurrence = await tx.recurringOccurrence.findFirst({
          where: { id: occurrenceId, userId },
          include: {
            rule: {
              select: {
                id: true,
                name: true,
                kind: true,
                currency: true,
                frequency: true,
                categoryId: true,
                defaultFundId: true,
                isActive: true,
                isArchived: true,
              },
            },
          },
        });

        if (!occurrence) {
          throw buildNotFoundRpc('Recurring occurrence not found');
        }

        const resolvedAmount = overrideAmount ?? formatMoney(occurrence.expectedAmount.toString());
        const resolvedDescription =
          overrideDescription ?? occurrence.rule.name.slice(0, MAX_DESCRIPTION_LENGTH);

        // Post-lock idempotency re-check before validating status === 'PENDING'
        const postLockExisting = await this.findTransactionByIdempotencyKey(
          tx,
          userId,
          idempotencyKey,
        );
        if (postLockExisting) {
          return this.resolveIdempotentPayResponse(
            tx,
            userId,
            occurrenceId,
            postLockExisting,
            {
              fundId,
              resolvedAmount,
              occurredOn,
              resolvedDescription,
              notes,
              categoryId: occurrence.rule.categoryId,
            },
            todayLima,
          );
        }

        if (occurrence.rule.isArchived) {
          throw buildConflictRpc('Cannot pay occurrence of an archived recurring rule');
        }

        if (occurrence.status !== 'PENDING') {
          throw buildConflictRpc(`Cannot pay occurrence with status ${occurrence.status}`);
        }

        // Validate category (system or user's own, !isArchived, matching kind)
        await this.validateCategoryForRule(
          tx,
          userId,
          occurrence.rule.categoryId,
          occurrence.rule.kind,
        );

        // DAG Level (4): funds FOR UPDATE
        const lockedFunds = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.funds
          WHERE id = ${fundId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE
        `;

        if (lockedFunds.length === 0) {
          throw buildNotFoundRpc('Fund not found');
        }

        const fund = await tx.fund.findFirst({
          where: { id: fundId, userId },
          select: {
            id: true,
            currency: true,
            allowNegativeBalance: true,
            isArchived: true,
          },
        });

        if (!fund) {
          throw buildNotFoundRpc('Fund not found');
        }

        if (fund.isArchived) {
          throw buildConflictRpc('Cannot pay occurrence using an archived fund');
        }

        if (fund.currency !== occurrence.currency) {
          throw buildBadRequestRpc(
            `Fund currency (${fund.currency}) must match occurrence currency (${occurrence.currency})`,
          );
        }

        const currentBalance = await this.getFundBalance(tx, userId, fund.id);
        const signedAmount =
          occurrence.rule.kind === 'INCOME'
            ? resolvedAmount
            : formatMoney(parseMoney(resolvedAmount).negated());

        const balanceAfter =
          occurrence.rule.kind === 'INCOME'
            ? addMoney(currentBalance, resolvedAmount)
            : subMoney(currentBalance, resolvedAmount);

        if (
          occurrence.rule.kind === 'EXPENSE' &&
          !fund.allowNegativeBalance &&
          parseMoney(balanceAfter).lessThan(0)
        ) {
          throw buildConflictRpc('Insufficient balance in fund');
        }

        const createdTx = await tx.financialTransaction.create({
          data: {
            userId,
            type: occurrence.rule.kind,
            status: 'POSTED',
            amount: resolvedAmount,
            currency: occurrence.currency,
            occurredOn: occurredOnDateUtc,
            description: resolvedDescription,
            notes,
            categoryId: occurrence.rule.categoryId,
            idempotencyKey,
          },
        });

        const createdEntry = await tx.fundEntry.create({
          data: {
            userId,
            transactionId: createdTx.id,
            fundId: fund.id,
            signedAmount,
            currency: occurrence.currency,
            occurredOn: occurredOnDateUtc,
          },
        });

        const updatedOccurrence = await tx.recurringOccurrence.update({
          where: { id: occurrence.id },
          data: {
            status: 'PAID',
            paidTransactionId: createdTx.id,
            paidAmount: resolvedAmount,
            paidAt: new Date(),
            skippedAt: null,
          },
          include: {
            rule: {
              select: {
                id: true,
                name: true,
                kind: true,
                currency: true,
                frequency: true,
                categoryId: true,
                defaultFundId: true,
                isActive: true,
                isArchived: true,
              },
            },
          },
        });

        return {
          occurrence: toOccurrenceView(updatedOccurrence, todayLima),
          transaction: toTransactionDetailView({
            ...createdTx,
            fundEntries: [createdEntry],
          }),
          fundBalanceAfter: balanceAfter,
        };
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        const winner = await this.findTransactionByIdempotencyKey(
          this.prisma,
          userId,
          idempotencyKey,
        );
        if (winner) {
          return this.resolveIdempotentPayResponse(
            this.prisma,
            userId,
            occurrenceId,
            winner,
            {
              fundId,
              resolvedAmount: resolvedAmountInitial,
              occurredOn,
              resolvedDescription: resolvedDescriptionInitial,
              notes,
              categoryId: occMeta.rule.categoryId,
            },
            todayLima,
          );
        }
      }
      throw error;
    }
  }

  async skipOccurrence(
    context: InternalAuthContext,
    payload: OccurrenceLifecycleTcpPayload,
  ): Promise<OccurrenceStatusResponse> {
    const userId = requireAuthenticatedUserId(context);
    const occurrenceId = requireUuid(payload.id, 'id');
    const todayLima = getLimaToday();

    const occMeta = await this.prisma.recurringOccurrence.findFirst({
      where: { id: occurrenceId, userId },
      select: { id: true, ruleId: true },
    });

    if (!occMeta) {
      throw buildNotFoundRpc('Recurring occurrence not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // DAG (2) recurring_rules -> (3) recurring_occurrences
      const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_rules
        WHERE id = ${occMeta.ruleId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      if (lockedRules.length === 0) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      const lockedOccurrences = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_occurrences
        WHERE id = ${occurrenceId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      if (lockedOccurrences.length === 0) {
        throw buildNotFoundRpc('Recurring occurrence not found');
      }

      const occurrence = await tx.recurringOccurrence.findFirst({
        where: { id: occurrenceId, userId },
        include: {
          rule: {
            select: {
              id: true,
              name: true,
              kind: true,
              currency: true,
              frequency: true,
              categoryId: true,
              defaultFundId: true,
              isActive: true,
              isArchived: true,
            },
          },
        },
      });

      if (!occurrence) {
        throw buildNotFoundRpc('Recurring occurrence not found');
      }

      if (occurrence.rule.isArchived) {
        throw buildConflictRpc('Cannot skip occurrence of an archived recurring rule');
      }

      if (occurrence.status !== 'PENDING') {
        throw buildConflictRpc(`Cannot skip occurrence with status ${occurrence.status}`);
      }

      const updated = await tx.recurringOccurrence.update({
        where: { id: occurrence.id },
        data: {
          status: 'SKIPPED',
          skippedAt: new Date(),
        },
        include: {
          rule: {
            select: {
              id: true,
              name: true,
              kind: true,
              currency: true,
              frequency: true,
              categoryId: true,
              defaultFundId: true,
              isActive: true,
              isArchived: true,
            },
          },
        },
      });

      return { occurrence: toOccurrenceView(updated, todayLima) };
    });
  }

  async unskipOccurrence(
    context: InternalAuthContext,
    payload: OccurrenceLifecycleTcpPayload,
  ): Promise<OccurrenceStatusResponse> {
    const userId = requireAuthenticatedUserId(context);
    const occurrenceId = requireUuid(payload.id, 'id');
    const todayLima = getLimaToday();

    const occMeta = await this.prisma.recurringOccurrence.findFirst({
      where: { id: occurrenceId, userId },
      select: { id: true, ruleId: true },
    });

    if (!occMeta) {
      throw buildNotFoundRpc('Recurring occurrence not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // DAG (2) recurring_rules -> (3) recurring_occurrences
      const lockedRules = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_rules
        WHERE id = ${occMeta.ruleId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      if (lockedRules.length === 0) {
        throw buildNotFoundRpc('Recurring rule not found');
      }

      const lockedOccurrences = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.recurring_occurrences
        WHERE id = ${occurrenceId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      if (lockedOccurrences.length === 0) {
        throw buildNotFoundRpc('Recurring occurrence not found');
      }

      const occurrence = await tx.recurringOccurrence.findFirst({
        where: { id: occurrenceId, userId },
        include: {
          rule: {
            select: {
              id: true,
              name: true,
              kind: true,
              currency: true,
              frequency: true,
              categoryId: true,
              defaultFundId: true,
              isActive: true,
              isArchived: true,
            },
          },
        },
      });

      if (!occurrence) {
        throw buildNotFoundRpc('Recurring occurrence not found');
      }

      if (occurrence.rule.isArchived) {
        throw buildConflictRpc('Cannot unskip occurrence of an archived recurring rule');
      }

      if (occurrence.status !== 'SKIPPED') {
        throw buildConflictRpc(`Cannot unskip occurrence with status ${occurrence.status}`);
      }

      const updated = await tx.recurringOccurrence.update({
        where: { id: occurrence.id },
        data: {
          status: 'PENDING',
          skippedAt: null,
        },
        include: {
          rule: {
            select: {
              id: true,
              name: true,
              kind: true,
              currency: true,
              frequency: true,
              categoryId: true,
              defaultFundId: true,
              isActive: true,
              isArchived: true,
            },
          },
        },
      });

      return { occurrence: toOccurrenceView(updated, todayLima) };
    });
  }
}
