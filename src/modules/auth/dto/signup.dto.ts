import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsArray, ValidateNested, IsIn, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductServiceDto {
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
}

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  companyDescription?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one product or service is required' })
  @ValidateNested({ each: true })
  @Type(() => ProductServiceDto)
  productsServices: ProductServiceDto[];
}
