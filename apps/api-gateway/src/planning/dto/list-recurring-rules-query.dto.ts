import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

const RECURRING_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY'] as const;
const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
const CURRENCY_CODES = ['PEN', 'USD'] as const;

function parseOptionalBooleanQuery(value: unknown): unknown {
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.trim() === 'true') return true;
    if (value.trim() === 'false') return false;
  }
  return value;
}

export class ListRecurringRulesQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseOptionalBooleanQuery(value))
  @IsBoolean({ message: 'includeArchived must be a boolean string (true or false)' })
  includeArchived?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseOptionalBooleanQuery(value))
  @IsBoolean({ message: 'isActive must be a boolean string (true or false)' })
  isActive?: boolean;

  @IsOptional()
  @IsIn(CATEGORY_KINDS, { message: 'kind must be INCOME or EXPENSE' })
  kind?: 'INCOME' | 'EXPENSE';

  @IsOptional()
  @IsIn(CURRENCY_CODES, { message: 'currency must be PEN or USD' })
  currency?: 'PEN' | 'USD';

  @IsOptional()
  @IsIn(RECURRING_FREQUENCIES, {
    message: 'frequency must be WEEKLY, BIWEEKLY, MONTHLY or YEARLY',
  })
  frequency?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';
}
