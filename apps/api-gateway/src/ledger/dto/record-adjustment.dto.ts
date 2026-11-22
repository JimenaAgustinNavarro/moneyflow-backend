import { AdjustmentDirection } from '@app/shared';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsGregorianDateString,
  IsPositiveMoneyString,
  POSITIVE_MONEY_REGEX,
  trimOptionalNullableString,
} from './record-transaction.dto';

const ADJUSTMENT_DIRECTIONS: readonly AdjustmentDirection[] = ['INCREASE', 'DECREASE'];

export class RecordAdjustmentDto {
  @IsUUID()
  fundId!: string;

  @IsIn(ADJUSTMENT_DIRECTIONS)
  direction!: AdjustmentDirection;

  @IsString()
  @Matches(POSITIVE_MONEY_REGEX, {
    message: 'amount must be a positive decimal string with up to 2 decimal places',
  })
  @IsPositiveMoneyString()
  amount!: string;

  @IsOptional()
  @IsString()
  @IsGregorianDateString()
  occurredOn?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimOptionalNullableString(value))
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
