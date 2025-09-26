import { IsNumber, IsString, IsDateString, IsOptional } from 'class-validator';

export class ProcessingStatusDto {
  uploadId: number;
  status: string;
  totalRecords: number;
  processedRecords: number;
  successfulRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  progress: number; // Percentage
  currentStep?: string;
  estimatedTimeRemaining?: number; // in seconds
  createdAt: Date;
  processedAt?: Date;
}

export class ProcessingResultDto {
  uploadId: number;
  status: string;
  summary: {
    totalRecords: number;
    successfulRecords: number;
    invalidRecords: number;
    duplicateRecords: number;
    processingTime: number; // in seconds
  };
  errors?: string[];
  warnings?: string[];
  recommendations?: string[];
  createdAt: Date;
  processedAt?: Date;
}

export class ProcessCsvResponseDto {
  uploadId: number;
  status: string;
  message: string;
  startedAt: Date;
}
