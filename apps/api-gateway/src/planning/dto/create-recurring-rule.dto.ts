import { isValidGregorianDate, parseMoney } from '@app/shared';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const POSITIVE_MONEY_REGEX = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_DECIMAL_14_2 = '999999999999.99';
const RECURRING_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY'] as const;
const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
const CURRENCY_CODES = ['PEN', 'USD'] as const;
const MAX_RULE_NAME_LENGTH = 120;
const MAX_NOTES_LENGTH = 500;

function IsPositiveMoneyAmount(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPositiveMoneyAmount',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !POSITIVE_MONEY_REGEX.test(value)) return false;
          try {
            const parsed = parseMoney(value);
            return parsed.greaterThan(0) && parsed.lessThanOrEqualTo(MAX_DECIMAL_14_2);
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a positive decimal string up to 2 decimal places`;
        },
      },
    });
  };
}

function IsGregorianDateString(validationOptions?: ValidationOptions): PropertyDecorator {
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
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid Gregorian calendar date in YYYY-MM-DD format`;
        },
      },
    });
  };
}

export class CreateRecurringRuleDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_RULE_NAME_LENGTH)
  name!: string;

  @IsIn(CATEGORY_KINDS, { message: 'kind must be INCOME or EXPENSE' })
  kind!: 'INCOME' | 'EXPENSE';

  @IsPositiveMoneyAmount()
  amount!: string;

  @IsIn(CURRENCY_CODES, { message: 'currency must be PEN or USD' })
  currency!: 'PEN' | 'USD';

  @IsIn(RECURRING_FREQUENCIES, {
    message: 'frequency must be WEEKLY, BIWEEKLY, MONTHLY or YEARLY',
  })
  frequency!: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';

  @IsGregorianDateString()
  startDate!: string;

  @IsOptional()
  @IsGregorianDateString()
  endDate?: string;

  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId!: string;

  @IsOptional()
  @IsUUID('4', { message: 'defaultFundId must be a valid UUID' })
  defaultFundId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES_LENGTH)
  notes?: string;
}
