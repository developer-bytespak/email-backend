import { IsObject, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ColumnMappingDto {
  @IsNotEmpty()
  businessName: string;

  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  website: string;

  @IsNotEmpty()
  phone: string;

  @IsNotEmpty()
  stateProvince: string;

  @IsNotEmpty()
  zip: string;

  @IsNotEmpty()
  country: string;
}

export class MapColumnsDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ColumnMappingDto)
  mapping: ColumnMappingDto;
}

export class MapColumnsResponseDto {
  uploadId: number;
  status: string;
  message: string;
  mapping: ColumnMappingDto;
}
