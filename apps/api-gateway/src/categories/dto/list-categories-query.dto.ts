import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { CategoryKindUnion } from '@app/shared';

export class ListCategoriesQueryDto {
  @IsOptional()
  @IsEnum(['INCOME', 'EXPENSE'], { message: 'kind must be either INCOME or EXPENSE' })
  kind?: CategoryKindUnion;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean({ message: 'includeArchived must be a boolean string (true or false)' })
  includeArchived?: boolean;
}
