import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsGregorianDateString, trimOptionalNullableString } from './record-transaction.dto';

export class VoidTransactionDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @IsGregorianDateString()
  occurredOn?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimOptionalNullableString(value))
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
