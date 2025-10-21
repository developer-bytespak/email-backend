import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ValidationService } from '../validation/validation.service';
import { Readable } from 'stream';
import csv = require('csv-parser');

interface CsvRow {
  business_name?: string;
  businessName?: string;
  state?: string;
  stateProvince?: string;
  zipcode?: string;
  zip?: string;
  zipCode?: string;
  phone_number?: string;
  phone?: string;
  website?: string;
  email?: string;
  country?: string;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: ValidationService,
  ) {}

  async processCsvUpload(file: any, clientId: number) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    // Create CSV upload record
    const csvUpload = await this.prisma.csvUpload.create({
      data: {
        clientId,
        fileName: file.originalname,
        status: 'success',
        totalRecords: 0,
        successfulRecords: 0,
        description: 'Processing...',
      },
    });

    try {
      // Parse CSV and extract data
      const extractedData = await this.parseCsvFile(file.buffer);
      
      // Save contacts to database (only essential fields)
      const savedContacts = await this.saveContacts(
        extractedData,
        csvUpload.id,
      );

      // Update CSV upload record with raw data
      await this.prisma.csvUpload.update({
        where: { id: csvUpload.id },
        data: {
          totalRecords: extractedData.length,
          successfulRecords: savedContacts.length,
          status: 'success',
          description: 'Processing complete',
          rawData: extractedData, // Store full CSV data as JSON
        },
      });

      // Auto-trigger validation in background
      this.validateUploadAsync(csvUpload.id);

      return {
        message: 'CSV file uploaded and processed successfully. Validation in progress...',
        filename: file.originalname,
        size: file.size,
        uploadId: csvUpload.id,
        totalRecords: extractedData.length,
        successfulRecords: savedContacts.length,
        data: extractedData,
        contacts: savedContacts,
        validationStatus: 'in_progress',
      };
    } catch (error) {
      // Update status to failure
      await this.prisma.csvUpload.update({
        where: { id: csvUpload.id },
        data: {
          status: 'failure',
          description: error.message || 'Processing failed',
        },
      });

      throw new BadRequestException(`CSV processing failed: ${error.message}`);
    }
  }

  private async parseCsvFile(buffer: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csv())
        .on('data', (row: CsvRow) => {
          // Keep all CSV data for raw storage
          results.push(row);
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  private async saveContacts(
    data: any[],
    csvUploadId: number,
  ): Promise<any[]> {
    const savedContacts: any[] = [];

    for (const row of data) {
      try {
        // Extract fields for Contact table
        const businessName = row.business_name || row.businessName || '';
        const email = row.email || null;
        const phone = row.phone_number || row.phone || null;
        const website = row.website || null;
        const state = row.state || row.stateProvince || null;
        const zipCode = row.zipcode || row.zip || row.zipCode || null;

        // Skip rows without business name
        if (!businessName || businessName.trim().length === 0) {
          console.warn('Skipping row with empty business name');
          continue;
        }

        const contact = await this.prisma.contact.create({
          data: {
            csvUploadId,
            businessName: businessName.trim(),
            email,
            phone,
            website,
            state,
            zipCode,
            status: 'new',
            valid: false,
            businessNameValid: false,
            emailValid: false,
            websiteValid: false,
          },
        });

        savedContacts.push(contact);
      } catch (error) {
        console.error(
          `Failed to save contact: ${row.business_name || row.businessName}`,
          error.message,
        );
        // Continue with next row even if one fails
      }
    }

    return savedContacts;
  }

  async validateLeadData(data: any) {
    // TODO: Implement lead data validation
    return true;
  }

  /**
   * Trigger validation in background (non-blocking)
   */
  private async validateUploadAsync(uploadId: number): Promise<void> {
    // Run validation asynchronously without blocking the response
    setImmediate(async () => {
      try {
        await this.validationService.validateUpload(uploadId);
      } catch (error) {
        console.error(`Validation failed for upload ${uploadId}:`, error);
      }
    });
  }

  // Example: Get all CSV uploads for a client
  async getClientUploads(clientId: number) {
    return this.prisma.csvUpload.findMany({
      where: { clientId },
      include: {
        contacts: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
