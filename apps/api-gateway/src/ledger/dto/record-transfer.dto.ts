import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  registerDecorator,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  IsGregorianDateString,
  IsPositiveMoneyString,
  POSITIVE_MONEY_REGEX,
  trimOptionalNullableString,
} from './record-transaction.dto';

function IsDifferentFund(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isDifferentFund',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as RecordTransferDto;
          if (typeof value !== 'string' || typeof dto.sourceFundId !== 'string') {
            return true;
          }
          return value.trim().toLowerCase() !== dto.sourceFundId.trim().toLowerCase();
        },
        defaultMessage(): string {
          return 'sourceFundId and destinationFundId must be different';
        },
      },
    });
  };
}

export class RecordTransferDto {
  @IsUUID()
  sourceFundId!: string;

  @IsUUID()
  @IsDifferentFund()
  destinationFundId!: string;

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
