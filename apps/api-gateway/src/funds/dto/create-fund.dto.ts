import { FundCurrencyCode, FundTypeValue } from '@app/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const CURRENCY_CODES: readonly FundCurrencyCode[] = ['PEN', 'USD'];
const FUND_TYPES: readonly FundTypeValue[] = ['CASH', 'BANK', 'WALLET', 'SAVINGS', 'OTHER'];
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const INITIAL_BALANCE_REGEX = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateFundDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsIn(FUND_TYPES)
  type!: FundTypeValue;

  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: FundCurrencyCode;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(HEX_COLOR_REGEX, { message: 'color must be a valid #RRGGBB hex color' })
  color?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;

  @IsOptional()
  @IsString()
  @Matches(INITIAL_BALANCE_REGEX, {
    message: 'initialBalance must be a non-negative decimal string with up to 2 decimal places',
  })
  initialBalance?: string;
}
