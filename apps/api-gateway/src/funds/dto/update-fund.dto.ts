import { FundTypeValue } from '@app/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const FUND_TYPES: readonly FundTypeValue[] = ['CASH', 'BANK', 'WALLET', 'SAVINGS', 'OTHER'];
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class UpdateFundDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(FUND_TYPES)
  type?: FundTypeValue;

  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(HEX_COLOR_REGEX, { message: 'color must be a valid #RRGGBB hex color' })
  color?: string | null;

  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;
}
