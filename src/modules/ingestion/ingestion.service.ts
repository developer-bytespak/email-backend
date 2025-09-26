import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { UploadCsvResponseDto } from './dto/upload-csv.dto';
import {
  MapColumnsResponseDto,
  ColumnMappingDto,
} from './dto/column-mapping.dto';
import {
  ProcessingStatusDto,
  ProcessingResultDto,
  ProcessCsvResponseDto,
} from './dto/processing-result.dto';
import { StrategyFactory } from './strategies/strategy-factory';
import { CsvParserService } from './services/csv-parser.service';
import { DuplicateDetectorService } from './services/duplicate-detector.service';

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyFactory: StrategyFactory,
    private readonly csvParser: CsvParserService,
    private readonly duplicateDetector: DuplicateDetectorService,
  ) {}

  async uploadCsv(file: Express.Multer.File, clientId: number): Promise<UploadCsvResponseDto> {
    // Validate file
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!file.originalname.endsWith('.csv')) {
      throw new BadRequestException('File must be a CSV file');
    }

    if (file.size > 10 * 1024 * 1024) {
      // 10MB limit
      throw new BadRequestException('File size must be less than 10MB');
    }

    // Convert clientId to integer and validate client exists
    const clientIdInt = parseInt(clientId.toString(), 10);
    if (isNaN(clientIdInt)) {
      throw new BadRequestException('Invalid client ID');
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientIdInt },
    });

    if (!client) {
      throw new BadRequestException('Client not found');
    }

    // Create CSV upload record
    const csvUpload = await this.prisma.csvUpload.create({
      data: {
        clientId: clientIdInt,
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

  async mapColumns(
    uploadId: number,
    mapping: ColumnMappingDto,
  ): Promise<MapColumnsResponseDto> {
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
    const hasRequiredField = requiredFields.some((field) =>
      mappedFields.includes(field),
    );

    if (!hasRequiredField) {
      throw new BadRequestException(
        'At least one of businessName, email, or website must be mapped',
      );
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
      include: { client: { include: { pricePlan: true } } },
    });

    if (!csvUpload) {
      throw new NotFoundException('CSV upload not found');
    }

    if (csvUpload.status !== 'processing') {
      throw new BadRequestException('CSV upload is not ready for processing');
    }

    try {
      // Start processing
      await this.prisma.csvUpload.update({
        where: { id: uploadId },
        data: { status: 'processing' },
      });

      // Get processing strategy based on client's plan
      const strategy = this.strategyFactory.createStrategy(
        csvUpload.client.pricePlan.name,
      );

      // TODO: Parse CSV file content (this would come from file storage)
      // For now, simulate processing
      const mockCsvContent =
        'businessName,email,website\nTest Company,test@example.com,https://example.com';
      const mapping = csvUpload.columnMapping as unknown as ColumnMappingDto;

      // Parse CSV data
      const parsedRows = this.csvParser.parseCsvData(mockCsvContent, mapping);

      let successfulRecords = 0;
      let invalidRecords = 0;
      let duplicateRecords = 0;

      // Process each row
      for (const rowData of parsedRows) {
        try {
          // Create contact record
          const contact = await this.prisma.contact.create({
            data: {
              csvUploadId: uploadId,
              clientId: csvUpload.clientId,
              businessName: rowData.businessName,
              email: rowData.email,
              phone: rowData.phone,
              website: rowData.website,
              stateProvince: rowData.stateProvince,
              zip: rowData.zip,
              country: rowData.country,
              status: 'new',
              valid: false,
              duplicateStatus: 'unique',
            },
          });

          // Validate contact using strategy
          const validationResult = await strategy.validateContact(contact);

          if (!validationResult.isValid) {
            // Mark as invalid
            await this.prisma.contact.update({
              where: { id: contact.id },
              data: {
                valid: false,
                validationReason: validationResult.reason,
              },
            });
            invalidRecords++;
            continue;
          }

          // Check for duplicates
          const duplicateResult = await this.duplicateDetector.detectDuplicates(
            contact,
            csvUpload.clientId,
          );

          if (duplicateResult.status !== 'unique') {
            // Mark as duplicate
            await this.prisma.contact.update({
              where: { id: contact.id },
              data: {
                duplicateStatus: duplicateResult.status,
                validationReason: duplicateResult.reason,
              },
            });
            duplicateRecords++;
            continue;
          }

          // Resolve website if strategy supports it
          if (strategy.shouldProcessWebsite(contact)) {
            const resolvedWebsite = await strategy.resolveWebsite(contact);
            if (resolvedWebsite && resolvedWebsite !== contact.website) {
              await this.prisma.contact.update({
                where: { id: contact.id },
                data: { website: resolvedWebsite },
              });
            }
          }

          // Mark as valid
          await this.prisma.contact.update({
            where: { id: contact.id },
            data: { valid: true },
          });

          successfulRecords++;
        } catch (error) {
          console.error(`Error processing row:`, error);
          invalidRecords++;
        }
      }

      // Update final counts
      await this.prisma.csvUpload.update({
        where: { id: uploadId },
        data: {
          status: 'success',
          totalRecords: parsedRows.length,
          successfulRecords,
          invalidRecords,
          duplicateRecords,
          processedAt: new Date(),
        },
      });

      return {
        uploadId,
        status: 'success',
        message: 'CSV processing completed successfully',
        startedAt: new Date(),
      };
    } catch (error) {
      // Mark as failed
      await this.prisma.csvUpload.update({
        where: { id: uploadId },
        data: {
          status: 'failure',
          processedAt: new Date(),
        },
      });

      throw new BadRequestException(`Processing failed: ${error.message}`);
    }
  }

  async getProcessingStatus(uploadId: number): Promise<ProcessingStatusDto> {
    const csvUpload = await this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
    });

    if (!csvUpload) {
      throw new NotFoundException('CSV upload not found');
    }

    const progress =
      csvUpload.totalRecords > 0
        ? (csvUpload.successfulRecords / csvUpload.totalRecords) * 100
        : 0;

    return {
      uploadId: csvUpload.id,
      status: csvUpload.status,
      totalRecords: csvUpload.totalRecords,
      processedRecords:
        csvUpload.successfulRecords +
        csvUpload.invalidRecords +
        csvUpload.duplicateRecords,
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
      ? Math.round(
          (csvUpload.processedAt.getTime() - csvUpload.createdAt.getTime()) /
            1000,
        )
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

  async createClient(clientData: any) {
    // Get the price plan ID based on the plan name
    const pricePlan = await this.prisma.pricePlan.findFirst({
      where: { name: clientData.pricePlan },
    });

    if (!pricePlan) {
      throw new BadRequestException(`Price plan '${clientData.pricePlan}' not found`);
    }

    // Create the client
    const client = await this.prisma.client.create({
      data: {
        name: clientData.name,
        email: clientData.email,
        phone: clientData.phone,
        city: clientData.city,
        country: clientData.country,
        address: clientData.address,
        hashPassword: 'temp_password', // TODO: Implement proper password hashing
        pricePlanId: pricePlan.id,
      },
    });

    return {
      success: true,
      data: {
        clientId: client.id,
        name: client.name,
        email: client.email,
        pricePlan: clientData.pricePlan,
      },
      message: 'Client created successfully',
    };
  }
}
