import { IsString, IsOptional, MinLength, Matches, IsArray, ValidateNested, IsIn, IsNumber, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductServiceDto {
  @IsNumber()
  @IsOptional()
  id?: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['product', 'service'])
  type?: 'product' | 'service';

  // businessName is optional - if provided, it will be used; otherwise auto-filled from existing records or client name
  @IsString()
  @IsOptional()
  businessName?: string;
}

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductServiceDto)
  productsServices?: UpdateProductServiceDto[];

  @IsString()
  @IsOptional()
  currentPassword?: string;

  @IsString()
  @IsOptional()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
  @Matches(/\d/, { message: 'Password must contain at least one number' })
  newPassword?: string;
}

