import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ValidationService } from '../validation/validation.service';
import { Readable } from 'stream';
import { Prisma, Contact as PrismaContact, ContactStatus } from '@prisma/client';
import { GetContactsQueryDto } from './dto/get-contacts-query.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { BulkUpdateContactsDto, BulkUpdateResult } from './dto/bulk-update-contacts.dto';
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

type ContactWithUpload = PrismaContact & {
  csvUpload?: {
    id: number;
    fileName: string;
    createdAt: Date;
  };
};

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: ValidationService,
  ) {}

  private computeContactValidity(contact: { emailValid: boolean; phone: string | null }) {
    const phone = contact.phone?.trim() ?? '';
    const hasPhone = phone.length > 0;
    const emailValid = contact.emailValid === true;

    if (emailValid && hasPhone) {
      return { isValid: true, reason: 'Valid email and phone number present' };
    }

    if (emailValid) {
      return { isValid: true, reason: 'Valid email address present' };
    }

    if (hasPhone) {
      return { isValid: true, reason: 'Phone number present (email not validated)' };
    }

    return { isValid: false, reason: 'Missing valid email and phone number' };
  }

  private mapContact(contact: ContactWithUpload) {
    const computed = this.computeContactValidity(contact);

    return {
      ...contact,
      computedValid: computed.isValid,
      computedValidationReason: computed.reason,
    };
  }

  private normalizeNullableField(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value.trim() === '') {
      return null;
    }
    return value.trim();
  }

  private normalizeContactUpdate(dto: UpdateContactDto): Prisma.ContactUpdateInput {
    const payload: Prisma.ContactUpdateInput = {};

    if (dto.businessName !== undefined) {
      payload.businessName = dto.businessName.trim();
    }

    if (dto.email !== undefined) {
      payload.email = this.normalizeNullableField(dto.email);
    }

    if (dto.phone !== undefined) {
      payload.phone = this.normalizeNullableField(dto.phone);
    }

    if (dto.website !== undefined) {
      payload.website = this.normalizeNullableField(dto.website);
    }

    if (dto.state !== undefined) {
      payload.state = this.normalizeNullableField(dto.state);
    }

    if (dto.zipCode !== undefined) {
      payload.zipCode = this.normalizeNullableField(dto.zipCode);
    }

    if (dto.status !== undefined) {
      payload.status = dto.status;
    }

    if (dto.valid !== undefined) {
      payload.valid = dto.valid;
    }

    return payload;
  }

  private buildContactsWhere(clientId: number, query: GetContactsQueryDto): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = {
      csvUpload: {
        clientId,
      },
    };

    if (query.csvUploadId) {
      where.csvUploadId = query.csvUploadId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      const search = query.search.trim();
      if (search.length > 0) {
        where.OR = [
          { businessName: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ];
      }
    }

    const andConditions: Prisma.ContactWhereInput[] = Array.isArray(where.AND)
      ? [...where.AND]
      : where.AND
      ? [where.AND]
      : [];

    if (query.validOnly) {
      andConditions.push({
        OR: [
          { emailValid: true },
          {
            AND: [
              { phone: { not: null } },
              { phone: { not: '' } },
            ],
          },
        ],
      });
    }

    if (query.invalidOnly) {
      andConditions.push({ emailValid: false });
      andConditions.push({
        OR: [
          { phone: null },
          { phone: '' },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return where;
  }

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

  /**
   * Legacy helper: list contacts across uploads for a client (limited filtering).
   * If limit is not provided, returns all contacts for the client.
   */
  async getAllClientContacts(
    clientId: number,
    filters?: {
      limit?: number;
      status?: string;
      valid?: boolean;
    },
  ): Promise<ContactWithUpload[]> {
    const where: Prisma.ContactWhereInput = {
      csvUpload: {
        clientId,
      },
    };

    if (filters?.status) {
      where.status = filters.status as ContactStatus;
    }

    if (filters?.valid !== undefined) {
      where.valid = filters.valid;
    }

    const queryOptions: Prisma.ContactFindManyArgs = {
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        csvUpload: {
          select: {
            id: true,
            fileName: true,
            createdAt: true,
          },
        },
      },
    };

    // Only apply limit if explicitly provided
    if (filters?.limit !== undefined && filters.limit > 0) {
      queryOptions.take = filters.limit;
    }

    const contacts = await this.prisma.contact.findMany(queryOptions);

    return contacts as ContactWithUpload[];
  }

  async listContacts(clientId: number, query: GetContactsQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 25;
    const skip = (page - 1) * limit;

    const where = this.buildContactsWhere(clientId, query);

    const [total, contacts] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          csvUpload: {
            select: {
              id: true,
              fileName: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return {
      data: contacts.map((contact) => this.mapContact(contact)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getContactById(clientId: number, contactId: number) {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        csvUpload: {
          clientId,
        },
      },
      include: {
        csvUpload: {
          select: {
            id: true,
            fileName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    return this.mapContact(contact);
  }

  async updateContact(clientId: number, contactId: number, dto: UpdateContactDto) {
    const existing = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        csvUpload: {
          clientId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    const normalizedEmail = this.normalizeNullableField(dto.email);
    const payload = this.normalizeContactUpdate(dto);

    await this.prisma.contact.update({
      where: { id: contactId },
      data: payload,
    });

    let emailValid = existing.emailValid;
    if (normalizedEmail !== undefined) {
      emailValid = normalizedEmail
        ? await this.validationService.validateEmail(normalizedEmail)
        : false;

      await this.prisma.contact.update({
        where: { id: contactId },
        data: {
          emailValid,
        },
      });
    }

    const refreshed = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        csvUpload: {
          select: {
            id: true,
            fileName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!refreshed) {
      throw new NotFoundException(`Contact with ID ${contactId} not found after update`);
    }

    const computed = this.computeContactValidity(refreshed);

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        valid: computed.isValid,
        validationReason: computed.reason,
      },
    });

    // Get the final updated contact with all relations
    const finalContact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        csvUpload: {
          select: {
            id: true,
            fileName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!finalContact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found after final update`);
    }

    return this.mapContact(finalContact);
  }

  async bulkUpdateContacts(
    clientId: number,
    dto: BulkUpdateContactsDto,
  ): Promise<BulkUpdateResult> {
    const updated: any[] = [];
    const failed: { id: number; error: string }[] = [];

    // Process each contact update
    for (const contactUpdate of dto.contacts) {
      try {
        // Extract id and create UpdateContactDto without id
        const { id, ...updateDto } = contactUpdate;
        const updatedContact = await this.updateContact(clientId, id, updateDto);
        updated.push(updatedContact);
      } catch (error) {
        failed.push({
          id: contactUpdate.id,
          error: error.message || 'Update failed',
        });
      }
    }

    return {
      updated,
      failed,
    };
  }
}
