import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  addMoney,
  AdjustmentDirection,
  formatMoney,
  FundCurrencyCode,
  FundEntryView,
  getLimaToday,
  GetTransactionByIdTcpPayload,
  GetTransactionResponse,
  InternalAuthContext,
  isValidGregorianDate,
  parseMoney,
  RecordableTransactionType,
  RecordAdjustmentResponse,
  RecordAdjustmentTcpPayload,
  RecordTransactionResponse,
  RecordTransactionTcpPayload,
  RecordTransferResponse,
  RecordTransferTcpPayload,
  subMoney,
  TransactionDetailView,
  TransactionSplitInput,
  TransactionSplitView,
  TransactionStatusValue,
  TransactionTypeValue,
} from '@app/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_DECIMAL_14_2 = '999999999999.99';
const POSITIVE_MONEY_REGEX = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_NOTES_LENGTH = 500;
const MAX_SPLIT_NOTE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_SPLITS_COUNT = 50;

interface DecimalLike {
  toString(): string;
}

interface FundEntryDbProjection {
  id: string;
  fundId: string;
  signedAmount: DecimalLike;
  currency: FundCurrencyCode;
  occurredOn: Date;
  createdAt: Date;
}

interface TransactionSplitDbProjection {
  id: string;
  categoryId: string;
  amount: DecimalLike;
  note: string | null;
  createdAt: Date;
}

interface TransactionDbProjection {
  id: string;
  type: TransactionTypeValue;
  status: TransactionStatusValue;
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
  transactionSplits: TransactionSplitDbProjection[];
}

interface NormalizedSplit {
  categoryId: string;
  amount: string;
  note: string | null;
}

interface NormalizedRecordRequest {
  type: RecordableTransactionType;
  fundId: string;
  amount: string;
  occurredOn: string;
  description: string;
  notes: string | null;
  categoryId: string | null;
  splits: NormalizedSplit[];
  idempotencyKey: string | null;
}

interface NormalizedTransferRequest {
  sourceFundId: string;
  destinationFundId: string;
  amount: string;
  occurredOn: string;
  description: string;
  notes: string | null;
  idempotencyKey: string | null;
}

interface NormalizedAdjustmentRequest {
  fundId: string;
  direction: AdjustmentDirection;
  amount: string;
  occurredOn: string;
  description: string;
  notes: string | null;
  idempotencyKey: string | null;
}

function buildBadRequestRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 400,
    error: 'Bad Request',
    message,
  });
}

function buildUnauthorizedRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 401,
    error: 'Unauthorized',
    message,
  });
}

function buildNotFoundRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 404,
    error: 'Not Found',
    message,
  });
}

function buildConflictRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 409,
    error: 'Conflict',
    message,
  });
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

function normalizeOptionalNote(raw: unknown, maxLength: number, fieldName: string): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw !== 'string') {
    throw buildBadRequestRpc(`${fieldName} must be a string`);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw buildBadRequestRpc(`${fieldName} exceeds maximum length of ${maxLength}`);
  }

  return trimmed;
}

function normalizeRecordPayload(payload: RecordTransactionTcpPayload): NormalizedRecordRequest {
  if (payload.type !== 'INCOME' && payload.type !== 'EXPENSE') {
    throw buildBadRequestRpc('type must be INCOME or EXPENSE');
  }

  if (typeof payload.fundId !== 'string' || payload.fundId.trim().length === 0) {
    throw buildBadRequestRpc('fundId is required');
  }

  const formattedAmount = validateAndFormatPositiveAmount(payload.amount, 'amount');

  let occurredOn = getLimaToday();
  if (payload.occurredOn !== undefined) {
    if (typeof payload.occurredOn !== 'string' || !isValidGregorianDate(payload.occurredOn)) {
      throw buildBadRequestRpc(
        'occurredOn must be a valid Gregorian calendar date in YYYY-MM-DD format',
      );
    }
    occurredOn = payload.occurredOn;
  }

  const trimmedDescription =
    typeof payload.description === 'string' ? payload.description.trim() : '';
  if (trimmedDescription.length === 0 || trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw buildBadRequestRpc('Invalid description');
  }

  const normalizedNotes = normalizeOptionalNote(payload.notes, MAX_NOTES_LENGTH, 'notes');

  let normalizedIdempotencyKey: string | null = null;
  if (payload.idempotencyKey !== undefined) {
    if (typeof payload.idempotencyKey !== 'string') {
      throw buildBadRequestRpc('Idempotency-Key must be a string');
    }
    const trimmedKey = payload.idempotencyKey.trim();
    if (trimmedKey.length === 0 || trimmedKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw buildBadRequestRpc('Idempotency-Key must be between 1 and 128 characters');
    }
    normalizedIdempotencyKey = trimmedKey;
  }

  const hasCategoryId = payload.categoryId !== undefined;
  const hasSplits = payload.splits !== undefined;

  if (hasCategoryId && hasSplits) {
    throw buildBadRequestRpc('Cannot provide both categoryId and splits');
  }

  if (!hasCategoryId && !hasSplits) {
    throw buildBadRequestRpc('Either categoryId or splits must be provided');
  }

  let normalizedCategoryId: string | null = null;
  const normalizedSplits: NormalizedSplit[] = [];

  if (hasCategoryId) {
    if (typeof payload.categoryId !== 'string' || payload.categoryId.trim().length === 0) {
      throw buildBadRequestRpc('Invalid categoryId');
    }
    normalizedCategoryId = payload.categoryId;
  } else {
    const rawSplits: TransactionSplitInput[] = Array.isArray(payload.splits) ? payload.splits : [];
    if (rawSplits.length < 2) {
      throw buildBadRequestRpc('splits must contain at least 2 items');
    }
    if (rawSplits.length > MAX_SPLITS_COUNT) {
      throw buildBadRequestRpc(`splits cannot contain more than ${MAX_SPLITS_COUNT} items`);
    }

    let splitsTotal = '0.00';
    for (const item of rawSplits) {
      if (typeof item.categoryId !== 'string' || item.categoryId.trim().length === 0) {
        throw buildBadRequestRpc('Each split must include a valid categoryId');
      }
      const splitAmount = validateAndFormatPositiveAmount(item.amount, 'splits.amount');
      const splitNote = normalizeOptionalNote(item.note, MAX_SPLIT_NOTE_LENGTH, 'splits.note');
      splitsTotal = addMoney(splitsTotal, splitAmount);
      normalizedSplits.push({
        categoryId: item.categoryId,
        amount: splitAmount,
        note: splitNote,
      });
    }

    if (splitsTotal !== formattedAmount) {
      throw buildBadRequestRpc('Sum of splits must equal transaction amount');
    }
  }

  return {
    type: payload.type,
    fundId: payload.fundId,
    amount: formattedAmount,
    occurredOn,
    description: trimmedDescription,
    notes: normalizedNotes,
    categoryId: normalizedCategoryId,
    splits: normalizedSplits,
    idempotencyKey: normalizedIdempotencyKey,
  };
}

function sortSplitsCanonically(
  splits: ReadonlyArray<{ categoryId: string; amount: string; note: string | null }>,
): Array<{ categoryId: string; amount: string; note: string | null }> {
  return [...splits].sort((left, right) => {
    const catCmp = left.categoryId.localeCompare(right.categoryId);
    if (catCmp !== 0) {
      return catCmp;
    }
    const amtCmp = left.amount.localeCompare(right.amount);
    if (amtCmp !== 0) {
      return amtCmp;
    }
    return (left.note ?? '').localeCompare(right.note ?? '');
  });
}

function isIdempotentRequestEquivalent(
  existing: TransactionDbProjection,
  normalized: NormalizedRecordRequest,
): boolean {
  if (existing.type !== normalized.type) {
    return false;
  }

  if (existing.fundEntries.length !== 1 || existing.fundEntries[0].fundId !== normalized.fundId) {
    return false;
  }

  if (formatMoney(existing.amount.toString()) !== normalized.amount) {
    return false;
  }

  if (formatDbCalendarDate(existing.occurredOn) !== normalized.occurredOn) {
    return false;
  }

  if (existing.description !== normalized.description) {
    return false;
  }

  if ((existing.notes ?? null) !== normalized.notes) {
    return false;
  }

  if ((existing.categoryId ?? null) !== normalized.categoryId) {
    return false;
  }

  if (existing.transactionSplits.length !== normalized.splits.length) {
    return false;
  }

  const existingCanonical = sortSplitsCanonically(
    existing.transactionSplits.map((split) => ({
      categoryId: split.categoryId,
      amount: formatMoney(split.amount.toString()),
      note: split.note ?? null,
    })),
  );
  const payloadCanonical = sortSplitsCanonically(normalized.splits);

  for (let i = 0; i < existingCanonical.length; i += 1) {
    if (
      existingCanonical[i].categoryId !== payloadCanonical[i].categoryId ||
      existingCanonical[i].amount !== payloadCanonical[i].amount ||
      existingCanonical[i].note !== payloadCanonical[i].note
    ) {
      return false;
    }
  }

  return true;
}

function normalizeCommonTxFields(payload: {
  amount: string;
  occurredOn?: string;
  description: string;
  notes?: string | null;
  idempotencyKey?: string;
}): {
  amount: string;
  occurredOn: string;
  description: string;
  notes: string | null;
  idempotencyKey: string | null;
} {
  const formattedAmount = validateAndFormatPositiveAmount(payload.amount, 'amount');

  let occurredOn = getLimaToday();
  if (payload.occurredOn !== undefined) {
    if (typeof payload.occurredOn !== 'string' || !isValidGregorianDate(payload.occurredOn)) {
      throw buildBadRequestRpc(
        'occurredOn must be a valid Gregorian calendar date in YYYY-MM-DD format',
      );
    }
    occurredOn = payload.occurredOn;
  }

  const trimmedDescription =
    typeof payload.description === 'string' ? payload.description.trim() : '';
  if (trimmedDescription.length === 0 || trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw buildBadRequestRpc('Invalid description');
  }

  const normalizedNotes = normalizeOptionalNote(payload.notes, MAX_NOTES_LENGTH, 'notes');

  let normalizedIdempotencyKey: string | null = null;
  if (payload.idempotencyKey !== undefined) {
    if (typeof payload.idempotencyKey !== 'string') {
      throw buildBadRequestRpc('Idempotency-Key must be a string');
    }
    const trimmedKey = payload.idempotencyKey.trim();
    if (trimmedKey.length === 0 || trimmedKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw buildBadRequestRpc('Idempotency-Key must be between 1 and 128 characters');
    }
    normalizedIdempotencyKey = trimmedKey;
  }

  return {
    amount: formattedAmount,
    occurredOn,
    description: trimmedDescription,
    notes: normalizedNotes,
    idempotencyKey: normalizedIdempotencyKey,
  };
}

function normalizeTransferPayload(payload: RecordTransferTcpPayload): NormalizedTransferRequest {
  const sourceFundId =
    typeof payload.sourceFundId === 'string' ? payload.sourceFundId.trim().toLowerCase() : '';
  const destinationFundId =
    typeof payload.destinationFundId === 'string'
      ? payload.destinationFundId.trim().toLowerCase()
      : '';

  if (sourceFundId.length === 0 || destinationFundId.length === 0) {
    throw buildBadRequestRpc('sourceFundId and destinationFundId are required');
  }

  if (sourceFundId === destinationFundId) {
    throw buildBadRequestRpc('sourceFundId and destinationFundId must be different');
  }

  const common = normalizeCommonTxFields(payload);
  return {
    sourceFundId,
    destinationFundId,
    ...common,
  };
}

function normalizeAdjustmentPayload(
  payload: RecordAdjustmentTcpPayload,
): NormalizedAdjustmentRequest {
  if (typeof payload.fundId !== 'string' || payload.fundId.trim().length === 0) {
    throw buildBadRequestRpc('fundId is required');
  }

  if (payload.direction !== 'INCREASE' && payload.direction !== 'DECREASE') {
    throw buildBadRequestRpc('direction must be INCREASE or DECREASE');
  }

  const common = normalizeCommonTxFields(payload);
  return {
    fundId: payload.fundId.trim().toLowerCase(),
    direction: payload.direction,
    ...common,
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

function toTransactionSplitView(split: TransactionSplitDbProjection): TransactionSplitView {
  return {
    id: split.id,
    categoryId: split.categoryId,
    amount: formatMoney(split.amount.toString()),
    note: split.note ?? null,
    createdAt: split.createdAt.toISOString(),
  };
}

function isIdempotentTransferEquivalent(
  existing: TransactionDbProjection,
  normalized: NormalizedTransferRequest,
): boolean {
  if (existing.type !== 'TRANSFER') {
    return false;
  }

  if (formatMoney(existing.amount.toString()) !== normalized.amount) {
    return false;
  }

  if (formatDbCalendarDate(existing.occurredOn) !== normalized.occurredOn) {
    return false;
  }

  if (existing.description !== normalized.description) {
    return false;
  }

  if ((existing.notes ?? null) !== normalized.notes) {
    return false;
  }

  if ((existing.categoryId ?? null) !== null || existing.transactionSplits.length !== 0) {
    return false;
  }

  if (existing.fundEntries.length !== 2) {
    return false;
  }

  const expectedNegativeAmount = formatMoney(parseMoney(normalized.amount).negated());
  const hasSourceEntry = existing.fundEntries.some(
    (entry) =>
      entry.fundId.toLowerCase() === normalized.sourceFundId &&
      formatMoney(entry.signedAmount.toString()) === expectedNegativeAmount,
  );
  const hasDestinationEntry = existing.fundEntries.some(
    (entry) =>
      entry.fundId.toLowerCase() === normalized.destinationFundId &&
      formatMoney(entry.signedAmount.toString()) === normalized.amount,
  );

  return hasSourceEntry && hasDestinationEntry;
}

function isIdempotentAdjustmentEquivalent(
  existing: TransactionDbProjection,
  normalized: NormalizedAdjustmentRequest,
): boolean {
  if (existing.type !== 'ADJUSTMENT') {
    return false;
  }

  if (formatMoney(existing.amount.toString()) !== normalized.amount) {
    return false;
  }

  if (formatDbCalendarDate(existing.occurredOn) !== normalized.occurredOn) {
    return false;
  }

  if (existing.description !== normalized.description) {
    return false;
  }

  if ((existing.notes ?? null) !== normalized.notes) {
    return false;
  }

  if ((existing.categoryId ?? null) !== null || existing.transactionSplits.length !== 0) {
    return false;
  }

  if (existing.fundEntries.length !== 1) {
    return false;
  }

  const expectedSignedAmount =
    normalized.direction === 'INCREASE'
      ? normalized.amount
      : formatMoney(parseMoney(normalized.amount).negated());

  return (
    existing.fundEntries[0].fundId.toLowerCase() === normalized.fundId &&
    formatMoney(existing.fundEntries[0].signedAmount.toString()) === expectedSignedAmount
  );
}

function toTransactionDetailView(txRecord: TransactionDbProjection): TransactionDetailView {
  const mappedEntries = txRecord.fundEntries.map(toFundEntryView);
  const entries =
    txRecord.type === 'TRANSFER'
      ? [...mappedEntries].sort((left, right) => {
          const leftNegative = parseMoney(left.signedAmount).isNegative();
          const rightNegative = parseMoney(right.signedAmount).isNegative();
          if (leftNegative === rightNegative) {
            return 0;
          }
          return leftNegative ? -1 : 1;
        })
      : mappedEntries;

  return {
    id: txRecord.id,
    type: txRecord.type,
    status: txRecord.status,
    amount: formatMoney(txRecord.amount.toString()),
    currency: txRecord.currency,
    occurredOn: formatDbCalendarDate(txRecord.occurredOn),
    recordedAt: txRecord.recordedAt.toISOString(),
    description: txRecord.description,
    notes: txRecord.notes ?? null,
    categoryId: txRecord.categoryId ?? null,
    relatedTransactionId: txRecord.relatedTransactionId ?? null,
    idempotencyKey: txRecord.idempotencyKey ?? null,
    createdAt: txRecord.createdAt.toISOString(),
    updatedAt: txRecord.updatedAt.toISOString(),
    entries,
    splits: txRecord.transactionSplits.map(toTransactionSplitView),
  };
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private async getFundBalance(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    fundId: string,
  ): Promise<string> {
    const agg = await db.fundEntry.aggregate({
      where: {
        userId,
        fundId,
      },
      _sum: { signedAmount: true },
    });

    return formatMoney(agg._sum.signedAmount?.toString() ?? '0.00');
  }

  private async findByIdempotencyKey(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<TransactionDbProjection | null> {
    return db.financialTransaction.findFirst({
      where: {
        userId,
        idempotencyKey,
      },
      include: {
        fundEntries: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        transactionSplits: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
  }

  async recordTransaction(
    context: InternalAuthContext,
    payload: RecordTransactionTcpPayload,
  ): Promise<RecordTransactionResponse> {
    const userId = requireAuthenticatedUserId(context);
    const normalized = normalizeRecordPayload(payload);
    const occurredOnDate = toLimaCalendarDateUtc(normalized.occurredOn);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (normalized.idempotencyKey !== null) {
          const existing = await tx.financialTransaction.findFirst({
            where: {
              userId,
              idempotencyKey: normalized.idempotencyKey,
            },
            include: {
              fundEntries: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
              transactionSplits: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            },
          });

          if (existing) {
            if (!isIdempotentRequestEquivalent(existing, normalized)) {
              throw buildConflictRpc(
                'Idempotency key already used with different request parameters',
              );
            }

            const existingAgg = await tx.fundEntry.aggregate({
              where: {
                userId,
                fundId: normalized.fundId,
              },
              _sum: { signedAmount: true },
            });

            return {
              transaction: toTransactionDetailView(existing),
              fundBalanceAfter: formatMoney(existingAgg._sum.signedAmount?.toString() ?? '0.00'),
            };
          }
        }

        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.funds
          WHERE id = ${normalized.fundId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE
        `;

        if (lockedRows.length === 0) {
          throw buildNotFoundRpc('Fund not found');
        }

        const fund = await tx.fund.findFirst({
          where: {
            id: normalized.fundId,
            userId,
          },
        });

        if (!fund) {
          throw buildNotFoundRpc('Fund not found');
        }

        if (fund.isArchived) {
          throw buildConflictRpc('Cannot record transaction on an archived fund');
        }

        const categoryIdsToValidate =
          normalized.categoryId !== null
            ? [normalized.categoryId]
            : Array.from(new Set(normalized.splits.map((split) => split.categoryId)));

        const categories = await tx.category.findMany({
          where: {
            id: { in: categoryIdsToValidate },
            OR: [{ isSystem: true }, { userId }],
          },
        });

        if (categories.length !== categoryIdsToValidate.length) {
          throw buildNotFoundRpc('Category not found');
        }

        for (const category of categories) {
          if (category.isArchived) {
            throw buildConflictRpc('Cannot use an archived category');
          }
          if (category.kind !== normalized.type) {
            throw buildBadRequestRpc('Category kind must match transaction type');
          }
        }

        const balanceAgg = await tx.fundEntry.aggregate({
          where: {
            userId,
            fundId: fund.id,
          },
          _sum: { signedAmount: true },
        });

        const currentBalance = formatMoney(balanceAgg._sum.signedAmount?.toString() ?? '0.00');
        const signedAmount =
          normalized.type === 'INCOME'
            ? normalized.amount
            : formatMoney(parseMoney(normalized.amount).negated());
        const fundBalanceAfter =
          normalized.type === 'INCOME'
            ? addMoney(currentBalance, normalized.amount)
            : subMoney(currentBalance, normalized.amount);

        if (
          normalized.type === 'EXPENSE' &&
          !fund.allowNegativeBalance &&
          parseMoney(fundBalanceAfter).lessThan(0)
        ) {
          throw buildConflictRpc('Insufficient balance in fund');
        }

        const createdHeader = await tx.financialTransaction.create({
          data: {
            userId,
            type: normalized.type,
            status: 'POSTED',
            amount: normalized.amount,
            currency: fund.currency,
            occurredOn: occurredOnDate,
            description: normalized.description,
            notes: normalized.notes,
            categoryId: normalized.categoryId,
            idempotencyKey: normalized.idempotencyKey,
          },
        });

        const createdEntry = await tx.fundEntry.create({
          data: {
            userId,
            transactionId: createdHeader.id,
            fundId: fund.id,
            signedAmount,
            currency: fund.currency,
            occurredOn: occurredOnDate,
          },
        });

        const createdSplits: TransactionSplitDbProjection[] = [];
        for (const split of normalized.splits) {
          const createdSplit = await tx.transactionSplit.create({
            data: {
              userId,
              transactionId: createdHeader.id,
              categoryId: split.categoryId,
              amount: split.amount,
              note: split.note,
            },
          });
          createdSplits.push(createdSplit);
        }

        return {
          transaction: toTransactionDetailView({
            ...createdHeader,
            fundEntries: [createdEntry],
            transactionSplits: createdSplits,
          }),
          fundBalanceAfter,
        };
      });
    } catch (error) {
      if (normalized.idempotencyKey !== null && isPrismaUniqueViolation(error)) {
        const winner = await this.prisma.financialTransaction.findFirst({
          where: {
            userId,
            idempotencyKey: normalized.idempotencyKey,
          },
          include: {
            fundEntries: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            transactionSplits: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        });

        if (!winner) {
          throw error;
        }

        if (!isIdempotentRequestEquivalent(winner, normalized)) {
          throw buildConflictRpc('Idempotency key already used with different request parameters');
        }

        const winnerAgg = await this.prisma.fundEntry.aggregate({
          where: {
            userId,
            fundId: normalized.fundId,
          },
          _sum: { signedAmount: true },
        });

        return {
          transaction: toTransactionDetailView(winner),
          fundBalanceAfter: formatMoney(winnerAgg._sum.signedAmount?.toString() ?? '0.00'),
        };
      }

      throw error;
    }
  }

  async getById(
    context: InternalAuthContext,
    payload: GetTransactionByIdTcpPayload,
  ): Promise<GetTransactionResponse> {
    const userId = requireAuthenticatedUserId(context);

    const txRecord = await this.prisma.financialTransaction.findFirst({
      where: {
        id: payload.id,
        userId,
      },
      include: {
        fundEntries: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        transactionSplits: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });

    if (!txRecord) {
      throw buildNotFoundRpc('Transaction not found');
    }

    return {
      transaction: toTransactionDetailView(txRecord),
    };
  }

  async recordTransfer(
    context: InternalAuthContext,
    payload: RecordTransferTcpPayload,
  ): Promise<RecordTransferResponse> {
    const userId = requireAuthenticatedUserId(context);
    const normalized = normalizeTransferPayload(payload);
    const occurredOnDate = toLimaCalendarDateUtc(normalized.occurredOn);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (normalized.idempotencyKey !== null) {
          const existing = await this.findByIdempotencyKey(tx, userId, normalized.idempotencyKey);
          if (existing) {
            if (!isIdempotentTransferEquivalent(existing, normalized)) {
              throw buildConflictRpc(
                'Idempotency key already used with different request parameters',
              );
            }

            const [sourceFundBalanceAfter, destinationFundBalanceAfter] = await Promise.all([
              this.getFundBalance(tx, userId, normalized.sourceFundId),
              this.getFundBalance(tx, userId, normalized.destinationFundId),
            ]);

            return {
              transaction: toTransactionDetailView(existing),
              sourceFundBalanceAfter,
              destinationFundBalanceAfter,
            };
          }
        }

        const [firstFundId, secondFundId] = [
          normalized.sourceFundId,
          normalized.destinationFundId,
        ].sort();

        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.funds
          WHERE id IN (${firstFundId}::uuid, ${secondFundId}::uuid)
            AND user_id = ${userId}::uuid
          ORDER BY id ASC
          FOR UPDATE
        `;

        if (lockedRows.length !== 2) {
          throw buildNotFoundRpc('Fund not found');
        }

        const funds = await tx.fund.findMany({
          where: {
            id: { in: [normalized.sourceFundId, normalized.destinationFundId] },
            userId,
          },
        });

        const sourceFund = funds.find((fund) => fund.id.toLowerCase() === normalized.sourceFundId);
        const destinationFund = funds.find(
          (fund) => fund.id.toLowerCase() === normalized.destinationFundId,
        );

        if (!sourceFund || !destinationFund) {
          throw buildNotFoundRpc('Fund not found');
        }

        if (sourceFund.isArchived || destinationFund.isArchived) {
          throw buildConflictRpc('Cannot transfer using an archived fund');
        }

        if (sourceFund.currency !== destinationFund.currency) {
          throw buildBadRequestRpc('Cannot transfer between funds with different currencies');
        }

        const [sourceCurrentBalance, destinationCurrentBalance] = await Promise.all([
          this.getFundBalance(tx, userId, sourceFund.id),
          this.getFundBalance(tx, userId, destinationFund.id),
        ]);

        const sourceSignedAmount = formatMoney(parseMoney(normalized.amount).negated());
        const destinationSignedAmount = normalized.amount;

        if (addMoney(sourceSignedAmount, destinationSignedAmount) !== '0.00') {
          throw buildBadRequestRpc('Transfer entries must sum to zero');
        }

        const sourceFundBalanceAfter = subMoney(sourceCurrentBalance, normalized.amount);
        const destinationFundBalanceAfter = addMoney(destinationCurrentBalance, normalized.amount);

        if (!sourceFund.allowNegativeBalance && parseMoney(sourceFundBalanceAfter).lessThan(0)) {
          throw buildConflictRpc('Insufficient balance in source fund');
        }

        const createdHeader = await tx.financialTransaction.create({
          data: {
            userId,
            type: 'TRANSFER',
            status: 'POSTED',
            amount: normalized.amount,
            currency: sourceFund.currency,
            occurredOn: occurredOnDate,
            description: normalized.description,
            notes: normalized.notes,
            categoryId: null,
            idempotencyKey: normalized.idempotencyKey,
          },
        });

        const sourceEntry = await tx.fundEntry.create({
          data: {
            userId,
            transactionId: createdHeader.id,
            fundId: sourceFund.id,
            signedAmount: sourceSignedAmount,
            currency: sourceFund.currency,
            occurredOn: occurredOnDate,
          },
        });

        const destinationEntry = await tx.fundEntry.create({
          data: {
            userId,
            transactionId: createdHeader.id,
            fundId: destinationFund.id,
            signedAmount: destinationSignedAmount,
            currency: destinationFund.currency,
            occurredOn: occurredOnDate,
          },
        });

        return {
          transaction: toTransactionDetailView({
            ...createdHeader,
            fundEntries: [sourceEntry, destinationEntry],
            transactionSplits: [],
          }),
          sourceFundBalanceAfter,
          destinationFundBalanceAfter,
        };
      });
    } catch (error) {
      if (normalized.idempotencyKey !== null && isPrismaUniqueViolation(error)) {
        const winner = await this.findByIdempotencyKey(
          this.prisma,
          userId,
          normalized.idempotencyKey,
        );

        if (!winner) {
          throw error;
        }

        if (!isIdempotentTransferEquivalent(winner, normalized)) {
          throw buildConflictRpc('Idempotency key already used with different request parameters');
        }

        const [sourceFundBalanceAfter, destinationFundBalanceAfter] = await Promise.all([
          this.getFundBalance(this.prisma, userId, normalized.sourceFundId),
          this.getFundBalance(this.prisma, userId, normalized.destinationFundId),
        ]);

        return {
          transaction: toTransactionDetailView(winner),
          sourceFundBalanceAfter,
          destinationFundBalanceAfter,
        };
      }

      throw error;
    }
  }

  async recordAdjustment(
    context: InternalAuthContext,
    payload: RecordAdjustmentTcpPayload,
  ): Promise<RecordAdjustmentResponse> {
    const userId = requireAuthenticatedUserId(context);
    const normalized = normalizeAdjustmentPayload(payload);
    const occurredOnDate = toLimaCalendarDateUtc(normalized.occurredOn);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (normalized.idempotencyKey !== null) {
          const existing = await this.findByIdempotencyKey(tx, userId, normalized.idempotencyKey);
          if (existing) {
            if (!isIdempotentAdjustmentEquivalent(existing, normalized)) {
              throw buildConflictRpc(
                'Idempotency key already used with different request parameters',
              );
            }

            const fundBalanceAfter = await this.getFundBalance(tx, userId, normalized.fundId);
            return {
              transaction: toTransactionDetailView(existing),
              fundBalanceAfter,
            };
          }
        }

        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.funds
          WHERE id = ${normalized.fundId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE
        `;

        if (lockedRows.length === 0) {
          throw buildNotFoundRpc('Fund not found');
        }

        const fund = await tx.fund.findFirst({
          where: {
            id: normalized.fundId,
            userId,
          },
        });

        if (!fund) {
          throw buildNotFoundRpc('Fund not found');
        }

        if (fund.isArchived) {
          throw buildConflictRpc('Cannot record adjustment on an archived fund');
        }

        const currentBalance = await this.getFundBalance(tx, userId, fund.id);
        const signedAmount =
          normalized.direction === 'INCREASE'
            ? normalized.amount
            : formatMoney(parseMoney(normalized.amount).negated());
        const fundBalanceAfter =
          normalized.direction === 'INCREASE'
            ? addMoney(currentBalance, normalized.amount)
            : subMoney(currentBalance, normalized.amount);

        if (
          normalized.direction === 'DECREASE' &&
          !fund.allowNegativeBalance &&
          parseMoney(fundBalanceAfter).lessThan(0)
        ) {
          throw buildConflictRpc('Insufficient balance in fund');
        }

        const createdHeader = await tx.financialTransaction.create({
          data: {
            userId,
            type: 'ADJUSTMENT',
            status: 'POSTED',
            amount: normalized.amount,
            currency: fund.currency,
            occurredOn: occurredOnDate,
            description: normalized.description,
            notes: normalized.notes,
            categoryId: null,
            idempotencyKey: normalized.idempotencyKey,
          },
        });

        const createdEntry = await tx.fundEntry.create({
          data: {
            userId,
            transactionId: createdHeader.id,
            fundId: fund.id,
            signedAmount,
            currency: fund.currency,
            occurredOn: occurredOnDate,
          },
        });

        return {
          transaction: toTransactionDetailView({
            ...createdHeader,
            fundEntries: [createdEntry],
            transactionSplits: [],
          }),
          fundBalanceAfter,
        };
      });
    } catch (error) {
      if (normalized.idempotencyKey !== null && isPrismaUniqueViolation(error)) {
        const winner = await this.findByIdempotencyKey(
          this.prisma,
          userId,
          normalized.idempotencyKey,
        );

        if (!winner) {
          throw error;
        }

        if (!isIdempotentAdjustmentEquivalent(winner, normalized)) {
          throw buildConflictRpc('Idempotency key already used with different request parameters');
        }

        const fundBalanceAfter = await this.getFundBalance(this.prisma, userId, normalized.fundId);

        return {
          transaction: toTransactionDetailView(winner),
          fundBalanceAfter,
        };
      }

      throw error;
    }
  }
}
