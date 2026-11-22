import {
  addMoney,
  formatMoney,
  isValidGregorianDate,
  parseMoney,
  RecordableTransactionType,
} from '@app/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  registerDecorator,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const TRANSACTION_TYPES: readonly RecordableTransactionType[] = ['INCOME', 'EXPENSE'];
export const POSITIVE_MONEY_REGEX = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_DECIMAL_14_2 = '999999999999.99';
const MAX_SPLITS_COUNT = 50;

function isPositiveMoneyInRange(value: unknown): boolean {
  if (typeof value !== 'string' || !POSITIVE_MONEY_REGEX.test(value)) {
    return false;
  }

  try {
    const parsed = parseMoney(value);
    return parsed.greaterThan(0) && parsed.lessThanOrEqualTo(MAX_DECIMAL_14_2);
  } catch {
    return false;
  }
}

export function IsPositiveMoneyString(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPositiveMoneyString',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isPositiveMoneyInRange(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a positive decimal string up to 2 decimal places`;
        },
      },
    });
  };
}

export function IsGregorianDateString(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isGregorianDateString',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidGregorianDate(value);
        },
        defaultMessage(): string {
          return 'occurredOn must be a valid Gregorian calendar date in YYYY-MM-DD format';
        },
      },
    });
  };
}

function IsCategoryXorSplits(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCategoryXorSplits',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as RecordTransactionDto;
          const hasCategoryId = dto.categoryId !== undefined;
          const hasSplits = dto.splits !== undefined;
          return hasCategoryId !== hasSplits;
        },
        defaultMessage(args: ValidationArguments): string {
          const dto = args.object as RecordTransactionDto;
          if (dto.categoryId !== undefined && dto.splits !== undefined) {
            return 'Cannot provide both categoryId and splits';
          }
          return 'Either categoryId or splits must be provided';
        },
      },
    });
  };
}

function IsSplitsSumEqualAmount(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isSplitsSumEqualAmount',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === undefined) {
            return true;
          }
          if (!Array.isArray(value) || value.length < 2) {
            return true;
          }

          const dto = args.object as RecordTransactionDto;
          if (!isPositiveMoneyInRange(dto.amount)) {
            return true;
          }

          let runningSum = '0.00';
          for (const item of value) {
            if (typeof item !== 'object' || item === null) {
              return true;
            }
            const splitAmount = (item as { amount?: unknown }).amount;
            if (!isPositiveMoneyInRange(splitAmount)) {
              return true;
            }
            runningSum = addMoney(runningSum, splitAmount as string);
          }

          return runningSum === formatMoney(dto.amount);
        },
        defaultMessage(): string {
          return 'Sum of splits must equal transaction amount';
        },
      },
    });
  };
}

export function trimOptionalNullableString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export class TransactionSplitItemDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @Matches(POSITIVE_MONEY_REGEX, {
    message: 'amount must be a positive decimal string with up to 2 decimal places',
  })
  @IsPositiveMoneyString()
  amount!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimOptionalNullableString(value))
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class RecordTransactionDto {
  @IsCategoryXorSplits()
  @IsIn(TRANSACTION_TYPES)
  type!: RecordableTransactionType;

  @IsUUID()
  fundId!: string;

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

  @ValidateIf((dto: RecordTransactionDto) => dto.categoryId !== undefined)
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_SPLITS_COUNT)
  @ValidateNested({ each: true })
  @Type(() => TransactionSplitItemDto)
  @IsSplitsSumEqualAmount()
  splits?: TransactionSplitItemDto[];
}
