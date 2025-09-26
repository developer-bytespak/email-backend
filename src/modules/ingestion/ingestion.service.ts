import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { UploadCsvResponseDto } from './dto/upload-csv.dto';
import { MapColumnsResponseDto, ColumnMappingDto } from './dto/column-mapping.dto';
import { ProcessingStatusDto, ProcessingResultDto, ProcessCsvResponseDto } from './dto/processing-result.dto';

@Injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadCsv(file: Express.Multer.File): Promise<UploadCsvResponseDto> {
    // Validate file
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!file.originalname.endsWith('.csv')) {
      throw new BadRequestException('File must be a CSV file');
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      throw new BadRequestException('File size must be less than 10MB');
    }

    // TODO: Get client ID from authentication context
    const clientId = 1; // Placeholder - should come from JWT token

    // Create CSV upload record
    const csvUpload = await this.prisma.csvUpload.create({
      data: {
        clientId,
        fileName: file.originalname,
        status: 'pending',
        totalRecords: 0, // Will be updated after parsing
        successfulRecords: 0,
        invalidRecords: 0,
        duplicateRecords: 0,
        description: `CSV upload: ${file.originalname}`,
      },
    });

    return {
      uploadId: csvUpload.id,
      fileName: csvUpload.fileName,
      status: csvUpload.status,
      message: 'CSV file uploaded successfully',
      createdAt: csvUpload.createdAt,
    };
  }

  async mapColumns(uploadId: number, mapping: ColumnMappingDto): Promise<MapColumnsResponseDto> {
    // Validate upload exists
    const csvUpload = await this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
    });

    if (!csvUpload) {
      throw new NotFoundException('CSV upload not found');
    }

    if (csvUpload.status !== 'pending') {
      throw new BadRequestException('CSV upload is not in pending status');
    }

    // Validate required mappings
    const requiredFields = ['businessName', 'email', 'website'];
    const mappedFields = Object.values(mapping);
    const hasRequiredField = requiredFields.some(field => 
      mappedFields.includes(field)
    );

    if (!hasRequiredField) {
      throw new BadRequestException('At least one of businessName, email, or website must be mapped');
    }

    // Update CSV upload with mapping
    const updatedUpload = await this.prisma.csvUpload.update({
      where: { id: uploadId },
      data: {
        columnMapping: mapping as any,
        status: 'processing',
      },
    });

    return {
      uploadId: updatedUpload.id,
      status: updatedUpload.status,
      message: 'Column mapping saved successfully',
      mapping,
    };
  }

  async processCsv(uploadId: number): Promise<ProcessCsvResponseDto> {
    // Validate upload exists and is ready for processing
    const csvUpload = await this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
    });

    if (!csvUpload) {
      throw new NotFoundException('CSV upload not found');
    }

    if (csvUpload.status !== 'processing') {
      throw new BadRequestException('CSV upload is not ready for processing');
    }

    // TODO: Implement background processing
    // For now, just update status
    await this.prisma.csvUpload.update({
      where: { id: uploadId },
      data: {
        status: 'success',
        processedAt: new Date(),
      },
    });

    return {
      uploadId,
      status: 'success',
      message: 'CSV processing started',
      startedAt: new Date(),
    };
  }

  async getProcessingStatus(uploadId: number): Promise<ProcessingStatusDto> {
    const csvUpload = await this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
    });

    if (!csvUpload) {
      throw new NotFoundException('CSV upload not found');
    }

    const progress = csvUpload.totalRecords > 0 
      ? (csvUpload.successfulRecords / csvUpload.totalRecords) * 100 
      : 0;

    return {
      uploadId: csvUpload.id,
      status: csvUpload.status,
      totalRecords: csvUpload.totalRecords,
      processedRecords: csvUpload.successfulRecords + csvUpload.invalidRecords + csvUpload.duplicateRecords,
      successfulRecords: csvUpload.successfulRecords,
      invalidRecords: csvUpload.invalidRecords,
      duplicateRecords: csvUpload.duplicateRecords,
      progress: Math.round(progress),
      createdAt: csvUpload.createdAt,
      processedAt: csvUpload.processedAt || undefined,
    };
  }

  async getProcessingResults(uploadId: number): Promise<ProcessingResultDto> {
    const csvUpload = await this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
    });

    if (!csvUpload) {
      throw new NotFoundException('CSV upload not found');
    }

    const processingTime = csvUpload.processedAt 
      ? Math.round((csvUpload.processedAt.getTime() - csvUpload.createdAt.getTime()) / 1000)
      : 0;

    return {
      uploadId: csvUpload.id,
      status: csvUpload.status,
      summary: {
        totalRecords: csvUpload.totalRecords,
        successfulRecords: csvUpload.successfulRecords,
        invalidRecords: csvUpload.invalidRecords,
        duplicateRecords: csvUpload.duplicateRecords,
        processingTime,
      },
      createdAt: csvUpload.createdAt,
      processedAt: csvUpload.processedAt || undefined,
    };
  }
}
