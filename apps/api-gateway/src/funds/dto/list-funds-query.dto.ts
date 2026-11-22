import { FundCurrencyCode, FundTypeValue } from '@app/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

const CURRENCY_CODES: readonly FundCurrencyCode[] = ['PEN', 'USD'];
const FUND_TYPES: readonly FundTypeValue[] = ['CASH', 'BANK', 'WALLET', 'SAVINGS', 'OTHER'];

function parseOptionalBooleanQuery(value: unknown): unknown {
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}

export class ListFundsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseOptionalBooleanQuery(value))
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: FundCurrencyCode;

  @IsOptional()
  @IsIn(FUND_TYPES)
  type?: FundTypeValue;
}
