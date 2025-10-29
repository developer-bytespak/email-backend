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
        note: 'Contact statuses will be updated after validation completes. Check back in a few moments for final statuses.',
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
    // Filter and prepare data for batch insert
    const contactsToCreate = data
      .map(row => {
        const businessName = row.business_name || row.businessName || '';
        
        // Skip rows without business name
        if (!businessName || businessName.trim().length === 0) {
          return null;
        }

        return {
          csvUploadId,
          businessName: businessName.trim(),
          email: row.email || null,
          phone: row.phone_number || row.phone || null,
          website: row.website || null,
          state: row.state || row.stateProvince || null,
          zipCode: row.zipcode || row.zip || row.zipCode || null,
          status: 'new' as const,
          valid: false,
          businessNameValid: false,
          emailValid: false,
          websiteValid: false,
        };
      })
      .filter(contact => contact !== null);

    if (contactsToCreate.length === 0) {
      return [];
    }

    try {
      // Use transaction to ensure atomicity and get exact created contacts
      const result = await this.prisma.$transaction(async (tx) => {
        // Batch insert contacts
        const insertResult = await tx.contact.createMany({
          data: contactsToCreate,
          skipDuplicates: true,
        });

        // Get the exact contacts we just created using a more precise query
        const createdContacts = await tx.contact.findMany({
          where: {
            csvUploadId,
            status: 'new',
            businessName: {
              in: contactsToCreate.map(c => c.businessName),
            },
          },
          orderBy: {
            id: 'asc',
          },
          take: insertResult.count,
        });

        return createdContacts;
      });

      return result;
    } catch (error) {
      console.error('Failed to save contacts in batch:', error.message);
      throw new BadRequestException(`Failed to save contacts: ${error.message}`);
    }
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

  /**
   * Get all CSV uploads for a specific client
   * Only returns uploads that belong to the authenticated client
   */
  async getClientUploads(clientId: number, includeContacts: boolean = false) {
    const include = includeContacts ? { contacts: true } : undefined;
    
    return this.prisma.csvUpload.findMany({
      where: { clientId },
      ...(include && { include }),
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get a specific CSV upload by ID
   */
  async getUploadById(uploadId: number) {
    return this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
      include: {
        contacts: {
          select: {
            id: true,
            businessName: true,
            email: true,
            phone: true,
            website: true,
            state: true,
            zipCode: true,
            status: true,
            valid: true,
          },
        },
      },
    });
  }
}
