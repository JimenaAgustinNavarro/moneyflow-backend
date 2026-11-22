import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MinLength(1, { message: 'name must be at least 1 character' })
  @MaxLength(100, { message: 'name must not exceed 100 characters' })
  name?: string;

  @IsOptional()
  @ValidateIf((_obj, val) => val !== null)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must be a valid hex color code in #RRGGBB format',
  })
  @MaxLength(20, { message: 'color must not exceed 20 characters' })
  color?: string | null;

  @IsOptional()
  @ValidateIf((_obj, val) => val !== null)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'icon must be a string' })
  @IsNotEmpty({ message: 'icon must not be empty' })
  @MinLength(1, { message: 'icon must be at least 1 character' })
  @MaxLength(50, { message: 'icon must not exceed 50 characters' })
  icon?: string | null;
}
