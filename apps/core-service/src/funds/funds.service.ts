import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  addMoney,
  ArchiveFundResponse,
  ArchiveFundTcpPayload,
  CreateFundResponse,
  CreateFundTcpPayload,
  CurrencyBalanceSummary,
  formatMoney,
  FundCurrencyCode,
  FundDetailView,
  FundTypeValue,
  FundView,
  getLimaToday,
  GetFundByIdTcpPayload,
  GetFundResponse,
  InternalAuthContext,
  ListFundsResponse,
  ListFundsTcpPayload,
  parseMoney,
  UpdateFundResponse,
  UpdateFundTcpPayload,
} from '@app/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_DECIMAL_14_2 = '999999999999.99';
const INITIAL_BALANCE_REGEX = /^\d{1,12}(\.\d{1,2})?$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const VALID_CURRENCIES: readonly FundCurrencyCode[] = ['PEN', 'USD'];
const VALID_FUND_TYPES: readonly FundTypeValue[] = ['CASH', 'BANK', 'WALLET', 'SAVINGS', 'OTHER'];
const CURRENCY_ORDER: Record<FundCurrencyCode, number> = {
  PEN: 0,
  USD: 1,
};

interface FundDbProjection {
  id: string;
  name: string;
  type: FundTypeValue;
  currency: FundCurrencyCode;
  color: string | null;
  icon: string | null;
  allowNegativeBalance: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
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

function toFundView(fund: FundDbProjection, balance: string): FundView {
  return {
    id: fund.id,
    name: fund.name,
    type: fund.type,
    currency: fund.currency,
    color: fund.color,
    icon: fund.icon,
    allowNegativeBalance: fund.allowNegativeBalance,
    isArchived: fund.isArchived,
    balance,
    createdAt: fund.createdAt.toISOString(),
    updatedAt: fund.updatedAt.toISOString(),
  };
}

function toLimaCalendarDateUtc(limaDateStr: string): Date {
  return new Date(`${limaDateStr}T00:00:00.000Z`);
}

function validateAndNormalizeInitialBalance(raw: string | undefined): string {
  if (raw === undefined) {
    return '0.00';
  }

  if (typeof raw !== 'string' || !INITIAL_BALANCE_REGEX.test(raw)) {
    throw buildBadRequestRpc(
      'initialBalance must be a non-negative decimal string with up to 2 decimal places',
    );
  }

  let parsed;
  try {
    parsed = parseMoney(raw);
  } catch {
    throw buildBadRequestRpc('Invalid initialBalance');
  }

  if (parsed.isNegative() || parsed.greaterThan(MAX_DECIMAL_14_2)) {
    throw buildBadRequestRpc('initialBalance exceeds allowed range');
  }

  return formatMoney(parsed);
}

function normalizeOptionalColor(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) {
    return raw;
  }

  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!HEX_COLOR_REGEX.test(trimmed)) {
    throw buildBadRequestRpc('color must be a valid #RRGGBB hex color');
  }

  return trimmed;
}

function normalizeOptionalIcon(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) {
    return raw;
  }

  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0 || trimmed.length > 50) {
    throw buildBadRequestRpc('Invalid fund icon');
  }

  return trimmed;
}

@Injectable()
export class FundsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    context: InternalAuthContext,
    payload: ListFundsTcpPayload,
  ): Promise<ListFundsResponse> {
    const userId = requireAuthenticatedUserId(context);

    const where: Prisma.FundWhereInput = {
      userId,
      ...(payload.includeArchived === true ? {} : { isArchived: false }),
      ...(payload.currency ? { currency: payload.currency } : {}),
      ...(payload.type ? { type: payload.type } : {}),
    };

    const funds = await this.prisma.fund.findMany({
      where,
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
    });

    if (funds.length === 0) {
      return {
        funds: [],
        totalsByCurrency: [],
      };
    }

    const aggregations = await this.prisma.fundEntry.groupBy({
      by: ['fundId'],
      where: {
        userId,
        fundId: { in: funds.map((fund) => fund.id) },
      },
      _sum: { signedAmount: true },
    });

    const balanceByFundId = new Map<string, string>();
    for (const row of aggregations) {
      balanceByFundId.set(row.fundId, formatMoney(row._sum.signedAmount?.toString() ?? '0.00'));
    }

    const totalsMap = new Map<FundCurrencyCode, { totalBalance: string; fundCount: number }>();
    const fundViews: FundView[] = [];

    for (const fund of funds) {
      const balance = balanceByFundId.get(fund.id) ?? '0.00';
      fundViews.push(toFundView(fund, balance));

      const existingTotal = totalsMap.get(fund.currency);
      if (existingTotal) {
        totalsMap.set(fund.currency, {
          totalBalance: addMoney(existingTotal.totalBalance, balance),
          fundCount: existingTotal.fundCount + 1,
        });
      } else {
        totalsMap.set(fund.currency, {
          totalBalance: balance,
          fundCount: 1,
        });
      }
    }

    const totalsByCurrency: CurrencyBalanceSummary[] = Array.from(totalsMap.entries())
      .sort(([left], [right]) => CURRENCY_ORDER[left] - CURRENCY_ORDER[right])
      .map(([currency, summary]) => ({
        currency,
        totalBalance: summary.totalBalance,
        fundCount: summary.fundCount,
      }));

    return {
      funds: fundViews,
      totalsByCurrency,
    };
  }

  async getById(
    context: InternalAuthContext,
    payload: GetFundByIdTcpPayload,
  ): Promise<GetFundResponse> {
    const userId = requireAuthenticatedUserId(context);

    const fund = await this.prisma.fund.findFirst({
      where: {
        id: payload.id,
        userId,
      },
    });

    if (!fund) {
      throw buildNotFoundRpc('Fund not found');
    }

    const aggregation = await this.prisma.fundEntry.aggregate({
      where: {
        userId,
        fundId: fund.id,
      },
      _sum: { signedAmount: true },
      _count: { _all: true },
    });

    const balance = formatMoney(aggregation._sum.signedAmount?.toString() ?? '0.00');
    const detailView: FundDetailView = {
      ...toFundView(fund, balance),
      entryCount: aggregation._count._all,
    };

    return { fund: detailView };
  }

  async create(
    context: InternalAuthContext,
    payload: CreateFundTcpPayload,
  ): Promise<CreateFundResponse> {
    const userId = requireAuthenticatedUserId(context);
    const trimmedName = typeof payload.name === 'string' ? payload.name.trim() : '';

    if (trimmedName.length === 0 || trimmedName.length > 100) {
      throw buildBadRequestRpc('Invalid fund name');
    }

    if (!VALID_FUND_TYPES.includes(payload.type)) {
      throw buildBadRequestRpc('Invalid fund type');
    }

    const currency: FundCurrencyCode = payload.currency ?? 'PEN';
    if (!VALID_CURRENCIES.includes(currency)) {
      throw buildBadRequestRpc('Invalid currency');
    }

    const color = normalizeOptionalColor(payload.color);
    const icon = normalizeOptionalIcon(payload.icon);
    const allowNegativeBalance = payload.allowNegativeBalance ?? false;
    const formattedInitialBalance = validateAndNormalizeInitialBalance(payload.initialBalance);
    const hasPositiveInitialBalance = parseMoney(formattedInitialBalance).greaterThan(0);

    try {
      if (!hasPositiveInitialBalance) {
        const created = await this.prisma.fund.create({
          data: {
            userId,
            name: trimmedName,
            type: payload.type,
            currency,
            color: color ?? null,
            icon: icon ?? null,
            allowNegativeBalance,
            isArchived: false,
          },
        });

        return { fund: toFundView(created, '0.00') };
      }

      const occurredOnDate = toLimaCalendarDateUtc(getLimaToday());

      const createdFund = await this.prisma.$transaction(async (tx) => {
        const fund = await tx.fund.create({
          data: {
            userId,
            name: trimmedName,
            type: payload.type,
            currency,
            color: color ?? null,
            icon: icon ?? null,
            allowNegativeBalance,
            isArchived: false,
          },
        });

        const txHeader = await tx.financialTransaction.create({
          data: {
            userId,
            type: 'ADJUSTMENT',
            status: 'POSTED',
            amount: formattedInitialBalance,
            currency,
            occurredOn: occurredOnDate,
            description: 'Saldo inicial',
          },
        });

        await tx.fundEntry.create({
          data: {
            userId,
            transactionId: txHeader.id,
            fundId: fund.id,
            signedAmount: formattedInitialBalance,
            currency,
            occurredOn: occurredOnDate,
          },
        });

        return fund;
      });

      return { fund: toFundView(createdFund, formattedInitialBalance) };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw buildConflictRpc('An active fund with this name already exists');
      }
      throw error;
    }
  }

  async update(
    context: InternalAuthContext,
    payload: UpdateFundTcpPayload,
  ): Promise<UpdateFundResponse> {
    const userId = requireAuthenticatedUserId(context);

    if (
      payload.name === undefined &&
      payload.type === undefined &&
      payload.color === undefined &&
      payload.icon === undefined &&
      payload.allowNegativeBalance === undefined
    ) {
      throw buildBadRequestRpc('At least one field must be provided for update');
    }

    const updateData: Prisma.FundUpdateInput = {};

    if (payload.name !== undefined) {
      const trimmedName = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (trimmedName.length === 0 || trimmedName.length > 100) {
        throw buildBadRequestRpc('Invalid fund name');
      }
      updateData.name = trimmedName;
    }

    if (payload.type !== undefined) {
      if (!VALID_FUND_TYPES.includes(payload.type)) {
        throw buildBadRequestRpc('Invalid fund type');
      }
      updateData.type = payload.type;
    }

    if (payload.color !== undefined) {
      updateData.color = normalizeOptionalColor(payload.color) ?? null;
    }

    if (payload.icon !== undefined) {
      updateData.icon = normalizeOptionalIcon(payload.icon) ?? null;
    }

    if (payload.allowNegativeBalance !== undefined) {
      updateData.allowNegativeBalance = payload.allowNegativeBalance;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM public.funds
          WHERE id = ${payload.id}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE
        `;

        if (lockedRows.length === 0) {
          throw buildNotFoundRpc('Fund not found');
        }

        const fund = await tx.fund.findFirst({
          where: {
            id: payload.id,
            userId,
          },
        });

        if (!fund) {
          throw buildNotFoundRpc('Fund not found');
        }

        if (fund.isArchived) {
          throw buildConflictRpc('Archived funds cannot be updated');
        }

        const aggregation = await tx.fundEntry.aggregate({
          where: {
            userId,
            fundId: fund.id,
          },
          _sum: { signedAmount: true },
        });

        const currentBalance = formatMoney(aggregation._sum.signedAmount?.toString() ?? '0.00');

        if (
          payload.allowNegativeBalance === false &&
          fund.allowNegativeBalance === true &&
          parseMoney(currentBalance).lessThan(0)
        ) {
          throw buildConflictRpc(
            'Cannot disable negative balance while current fund balance is negative',
          );
        }

        const updated = await tx.fund.update({
          where: { id: fund.id },
          data: updateData,
        });

        return {
          fund: toFundView(updated, currentBalance),
        };
      });

      return result;
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw buildConflictRpc('An active fund with this name already exists');
      }
      throw error;
    }
  }

  async archive(
    context: InternalAuthContext,
    payload: ArchiveFundTcpPayload,
  ): Promise<ArchiveFundResponse> {
    const userId = requireAuthenticatedUserId(context);

    return this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM public.funds
        WHERE id = ${payload.id}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;

      if (lockedRows.length === 0) {
        throw buildNotFoundRpc('Fund not found');
      }

      const fund = await tx.fund.findFirst({
        where: {
          id: payload.id,
          userId,
        },
      });

      if (!fund) {
        throw buildNotFoundRpc('Fund not found');
      }

      if (fund.isArchived) {
        throw buildConflictRpc('Fund is already archived');
      }

      const aggregation = await tx.fundEntry.aggregate({
        where: {
          userId,
          fundId: fund.id,
        },
        _sum: { signedAmount: true },
      });

      const currentBalance = formatMoney(aggregation._sum.signedAmount?.toString() ?? '0.00');
      if (!parseMoney(currentBalance).isZero()) {
        throw buildConflictRpc('Cannot archive a fund with a non-zero balance');
      }

      const archived = await tx.fund.update({
        where: { id: fund.id },
        data: { isArchived: true },
      });

      return {
        fund: toFundView(archived, '0.00'),
        message: 'Fund archived successfully.',
      };
    });
  }
}
