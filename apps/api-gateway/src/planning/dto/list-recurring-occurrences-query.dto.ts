import { isValidGregorianDate } from '@app/shared';
import {
  IsIn,
  IsOptional,
  IsUUID,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const OCCURRENCE_STATUSES = ['PENDING', 'PAID', 'SKIPPED'] as const;
const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
const CURRENCY_CODES = ['PEN', 'USD'] as const;

function IsGregorianDateQuery(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isGregorianDateQuery',
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

function IsFromDateLeToDate(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isFromDateLeToDate',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as ListRecurringOccurrencesQueryDto;
          if (typeof dto.fromDate !== 'string' || typeof value !== 'string') {
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

export class ListRecurringOccurrencesQueryDto {
  @IsOptional()
  @IsGregorianDateQuery()
  fromDate?: string;

  @IsOptional()
  @IsGregorianDateQuery()
  @IsFromDateLeToDate()
  toDate?: string;

  @IsOptional()
  @IsIn(OCCURRENCE_STATUSES, { message: 'status must be PENDING, PAID or SKIPPED' })
  status?: 'PENDING' | 'PAID' | 'SKIPPED';

  @IsOptional()
  @IsIn(CURRENCY_CODES, { message: 'currency must be PEN or USD' })
  currency?: 'PEN' | 'USD';

  @IsOptional()
  @IsIn(CATEGORY_KINDS, { message: 'kind must be INCOME or EXPENSE' })
  kind?: 'INCOME' | 'EXPENSE';

  @IsOptional()
  @IsUUID('4', { message: 'ruleId must be a valid UUID' })
  ruleId?: string;
}
