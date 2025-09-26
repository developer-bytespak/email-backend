import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class UploadCsvDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UploadCsvResponseDto {
  uploadId: number;
  fileName: string;
  status: string;
  message: string;
  createdAt: Date;
}
