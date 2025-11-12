import { ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateContactDto } from './update-contact.dto';

export class BulkUpdateContactPayloadDto extends UpdateContactDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}

export class BulkUpdateContactsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateContactPayloadDto)
  contacts!: BulkUpdateContactPayloadDto[];
}

export interface BulkUpdateResult {
  updated: any[];
  failed: {
    id: number;
    error: string;
  }[];
}


