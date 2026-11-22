import {
  FundCurrencyCode,
  isValidGregorianDate,
  TransactionStatusValue,
  TransactionTypeValue,
} from '@app/shared';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { IsGregorianDateString } from './record-transaction.dto';

const TRANSACTION_TYPES: readonly TransactionTypeValue[] = [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'ADJUSTMENT',
  'VOID',
  'REFUND',
];

const TRANSACTION_STATUSES: readonly TransactionStatusValue[] = ['POSTED', 'VOIDED'];
const CURRENCY_CODES: readonly FundCurrencyCode[] = ['PEN', 'USD'];

function parseStrictPositiveIntQuery(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return value;
    }
    return Number.parseInt(trimmed, 10);
  }

  return value;
}

function IsValidDateRange(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isValidDateRange',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as ListTransactionsQueryDto;
          if (typeof dto.fromDate !== 'string' || typeof value !== 'string') {
            return true;
          }
          if (!isValidGregorianDate(dto.fromDate) || !isValidGregorianDate(value)) {
            return true;
          }
          return dto.fromDate <= value;
        },
        defaultMessage(): string {
          return 'fromDate must be less than or equal to toDate';
        },
      },
    });
  };
}

export class ListTransactionsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseStrictPositiveIntQuery(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseStrictPositiveIntQuery(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  fundId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionTypeValue;

  @IsOptional()
  @IsIn(TRANSACTION_STATUSES)
  status?: TransactionStatusValue;

  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: FundCurrencyCode;

  @IsOptional()
  @IsString()
  @IsGregorianDateString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  @IsGregorianDateString()
  @IsValidDateRange()
  toDate?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  search?: string;
}
