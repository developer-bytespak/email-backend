import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ValidationService } from '../validation/validation.service';
import { Readable } from 'stream';
import { Prisma, Contact as PrismaContact, ContactStatus } from '@prisma/client';
import { GetContactsQueryDto } from './dto/get-contacts-query.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { BulkUpdateContactsDto, BulkUpdateResult } from './dto/bulk-update-contacts.dto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
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

  /**
   * Check if a phone number is valid in E.164 format
   * Phone must start with + and be parseable with national number length 7-15
   */
  private isPhoneValidE164(phone: string | null | undefined): boolean {
    if (!phone || !phone.trim()) return false;
    
    const cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    
    // Must start with + for E.164 format
    if (!cleaned.startsWith('+')) return false;
    
    try {
      const parsed = parsePhoneNumberFromString(cleaned);
      if (!parsed) return false;
      
      const nationalNumber = parsed.nationalNumber;
      // Allow numbers that can be parsed, even if isValid() returns false
      // Only check length requirements (7-15 digits)
      return nationalNumber.length >= 7 && nationalNumber.length <= 15;
    } catch {
      return false;
    }
  }

  /**
   * Determine if a contact is invalid based on the validation logic (matches frontend)
   * Contact is invalid if ANY of these conditions are met:
   * 1. Phone exists but is not in E.164 format (phone blocker)
   * 2. Website exists AND website is invalid (website blocker)
   * 3. No valid email AND no valid phone (base invalidity)
   * 
   * Contact is valid if:
   * (Valid email OR Valid phone in E.164) AND (No website OR website is valid)
   */
  private isContactInvalid(contact: ContactWithUpload): boolean {
    // Check email validity
    const emailValid = contact.emailValid === true;
    
    // Check phone validity (E.164 format required)
    const phone = contact.phone?.trim() ?? '';
    const phoneExists = phone.length > 0;
    const hasValidPhone = this.isPhoneValidE164(contact.phone);
    
    // Phone blocker: If phone exists but is not in E.164 format, contact is invalid
    // This must be checked first (priority) - matches frontend logic
    if (phoneExists && !hasValidPhone) {
      return true;
    }
    
    // Check website validity
    const website = contact.website?.trim() ?? '';
    const hasWebsite = website.length > 0;
    const websiteValid = contact.websiteValid === true;
    
    // Website blocker: If website exists but is invalid, contact is invalid
    if (hasWebsite && contact.websiteValid === false) {
      return true;
    }
    
    // Base invalidity: Contact is invalid if no valid email AND no valid phone
    return !emailValid && !hasValidPhone;
  }

  private computeContactValidity(contact: { 
    emailValid: boolean; 
    phone: string | null;
    websiteValid?: boolean;
    website?: string | null;
  }) {
    // 1. Check Email: must exist AND emailValid === true from DB
    const emailValid = contact.emailValid === true;
    
    // 2. Check Phone: must exist AND length 7-15 digits
    const phone = contact.phone?.trim() ?? '';
    const phoneDigits = phone.replace(/\D/g, ''); // Remove non-digits
    const hasValidPhone = phoneDigits.length >= 7 && phoneDigits.length <= 15;
    
    // 3. Check Website: if exists, must be valid (websiteValid === true)
    const website = contact.website?.trim() ?? '';
    const hasWebsite = website.length > 0;
    const websiteExistsAndInvalid = hasWebsite && contact.websiteValid === false;
    
    // Website blocker: If website exists but is invalid, contact is invalid
    if (websiteExistsAndInvalid) {
      return { 
        isValid: false, 
        reason: 'Website exists but is invalid (websiteValid = false)' 
      };
    }
    
    // Contact is valid if: (Valid email OR Valid phone) AND (No website OR website is valid)
    if (emailValid && hasValidPhone) {
      return { isValid: true, reason: 'Valid email and valid phone number (7-15 digits) present' };
    }
    
    if (emailValid) {
      return { isValid: true, reason: 'Valid email address present' };
    }
    
    if (hasValidPhone) {
      return { isValid: true, reason: 'Valid phone number (7-15 digits) present' };
    }
    
    return { isValid: false, reason: 'Missing valid email or valid phone number (7-15 digits)' };
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

    // Explicitly exclude valid and validationReason from updates
    // These fields are managed by the validation service only
    // For contact updates, we only update email and phone fields

    return payload;
  }

  /**
   * Build search conditions based on search term and searchField
   */
  private buildSearchConditions(
    search: string,
    searchField?: 'all' | 'businessName' | 'email' | 'website',
  ): Prisma.ContactWhereInput[] {
    const field = searchField || 'all';
    const searchConditions: Prisma.ContactWhereInput[] = [];

    // Build search conditions based on searchField
    if (field === 'all' || field === 'businessName') {
      searchConditions.push({
        businessName: { contains: search, mode: Prisma.QueryMode.insensitive },
      });
    }

    if (field === 'all' || field === 'email') {
      searchConditions.push({
        email: { contains: search, mode: Prisma.QueryMode.insensitive },
      });
    }

    if (field === 'all' || field === 'website') {
      searchConditions.push({
        website: { contains: search, mode: Prisma.QueryMode.insensitive },
      });
    }

    // For 'all', also include phone (backward compatibility)
    if (field === 'all') {
      searchConditions.push({
        phone: { contains: search, mode: Prisma.QueryMode.insensitive },
      });
    }

    return searchConditions;
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
        const searchConditions = this.buildSearchConditions(search, query.searchField);
        if (searchConditions.length > 0) {
          where.OR = searchConditions;
        }
      }
    }

    const andConditions: Prisma.ContactWhereInput[] = Array.isArray(where.AND)
      ? [...where.AND]
      : where.AND
      ? [where.AND]
      : [];

    if (query.validOnly) {
      // Valid = (Valid email OR Valid phone) AND (No website OR website is valid)
      // Valid email = email exists AND emailValid === true
      // Valid phone = phone exists AND length between 7-15 characters (digit validation done in application layer)
      // Website condition = no website OR websiteValid === true
      andConditions.push({
        AND: [
          {
            // Primary condition: Valid email OR Valid phone
            OR: [
              {
                // Valid email: email exists AND emailValid === true
                AND: [
                  { email: { not: null } },
                  { email: { not: '' } },
                  { emailValid: true },
                ],
              },
              {
                // Valid phone: phone exists (length validation done in computeContactValidity)
                AND: [
                  { phone: { not: null } },
                  { phone: { not: '' } },
                  { phone: { not: { contains: '' } } }, // Ensure it's not empty
                ],
              },
            ],
          },
          {
            // Website condition: no website OR website is valid
            OR: [
              {
                OR: [
                  { website: null },
                  { website: { equals: '' } },
                ],
              },
              { websiteValid: true },
            ],
          },
        ],
      });
    }

    if (query.invalidOnly) {
      // Invalid = (No valid email AND No valid phone) OR (Website exists AND website is invalid)
      // No valid email = email is null/empty OR emailValid === false
      // No valid phone = phone is null/empty
      // Website invalid = website exists AND websiteValid === false
      andConditions.push({
        OR: [
          {
            // Condition 1: No valid email AND No valid phone
            AND: [
              {
                OR: [
                  { email: null },
                  { email: { equals: '' } },
                  { emailValid: false },
                ],
              },
              {
                OR: [
                  { phone: null },
                  { phone: { equals: '' } },
                ],
              },
            ],
          },
          {
            // Condition 2: Website exists AND website is invalid
            AND: [
              { website: { not: null } },
              { website: { not: '' } },
              { websiteValid: false },
            ],
          },
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

    // Get latest ScrapedData for each contact to include errorMessage
    const contactIds = contacts.map(c => c.id);
    if (contactIds.length === 0) {
      return contacts as ContactWithUpload[];
    }

    const allFailedScrapedData = await this.prisma.scrapedData.findMany({
      where: {
        contactId: { in: contactIds },
        scrapeSuccess: false,
      },
      orderBy: {
        scrapedAt: 'desc',
      },
    });

    // Group by contactId and get the latest one (first in desc order) for each contact
    const latestScrapedDataMap = new Map<number, any>();
    for (const sd of allFailedScrapedData) {
      if (!latestScrapedDataMap.has(sd.contactId)) {
        latestScrapedDataMap.set(sd.contactId, sd);
      }
    }

    // Create a map of contactId -> latest errorMessage
    const errorMessageMap = new Map(
      Array.from(latestScrapedDataMap.values()).map(sd => [sd.contactId, sd.errorMessage])
    );

    // Add errorMessage to contacts
    return contacts.map(contact => ({
      ...contact,
      errorMessage: errorMessageMap.get(contact.id) || null,
    })) as ContactWithUpload[];
  }

  /**
   * Get all invalid contacts for a client (no pagination)
   * Invalid contacts are those that meet ANY of these conditions:
   * 1. Phone exists but is not in E.164 format (phone blocker)
   * 2. No valid email AND no valid phone (E.164 format required)
   * 3. Website is present but invalid (websiteValid === false)
   * 
   * Note: Phone numbers must be in E.164 format (start with + and be parseable)
   * This matches the frontend validation logic exactly.
   */
  async getAllInvalidContacts(clientId: number): Promise<ContactWithUpload[]> {
    // Fetch ALL contacts for the client
    // We can't check E.164 format in Prisma, so we must fetch all and filter in memory
    const where: Prisma.ContactWhereInput = {
      csvUpload: {
        clientId,
      },
      // No filters - fetch all contacts and filter in memory
    };

    const contacts = await this.prisma.contact.findMany({
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
    });

    // Map contacts and filter by E.164 validation logic
    const mappedContacts = contacts.map((contact) => this.mapContact(contact)) as ContactWithUpload[];
    
    // Filter contacts using the validation logic (E.164 format check)
    // This catches ALL invalid contacts:
    // - Phone exists but not in E.164 format (phone blocker)
    // - No valid email AND no valid phone (E.164)
    // - Invalid website (website blocker)
    return mappedContacts.filter((contact) => this.isContactInvalid(contact));
  }

  /**
   * Get invalid contacts from a specific CSV upload
   * Uses the same validation logic as getAllInvalidContacts but filters by csvUploadId
   */
  async getInvalidContactsByCsvUpload(clientId: number, csvUploadId: number): Promise<ContactWithUpload[]> {
    // First verify the CSV upload belongs to the client
    const upload = await this.prisma.csvUpload.findFirst({
      where: {
        id: csvUploadId,
        clientId,
      },
    });

    if (!upload) {
      throw new NotFoundException(`CSV upload with ID ${csvUploadId} not found or does not belong to client`);
    }

    // Fetch ALL contacts from this CSV upload
    // We can't check E.164 format in Prisma, so we must fetch all and filter in memory
    const where: Prisma.ContactWhereInput = {
      csvUploadId,
      csvUpload: {
        clientId,
      },
      // No filters - fetch all contacts and filter in memory
    };

    const contacts = await this.prisma.contact.findMany({
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
    });

    // Map contacts and filter by E.164 validation logic
    const mappedContacts = contacts.map((contact) => this.mapContact(contact)) as ContactWithUpload[];
    
    // Filter contacts using the validation logic (E.164 format check)
    // This catches ALL invalid contacts:
    // - Phone exists but not in E.164 format
    // - No valid email AND no valid phone (E.164)
    // - Invalid website
    return mappedContacts.filter((contact) => this.isContactInvalid(contact));
  }

  async listContacts(clientId: number, query: GetContactsQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 25;
    const skip = (page - 1) * limit;

    const where = this.buildContactsWhere(clientId, query);

    // Build base where clause for total counts (without validity filters)
    const baseWhere: Prisma.ContactWhereInput = {
      csvUpload: {
        clientId,
      },
    };

    if (query.csvUploadId) {
      baseWhere.csvUploadId = query.csvUploadId;
    }

    if (query.status) {
      baseWhere.status = query.status;
    }

    if (query.search) {
      const search = query.search.trim();
      if (search.length > 0) {
        const searchConditions = this.buildSearchConditions(search, query.searchField);
        if (searchConditions.length > 0) {
          baseWhere.OR = searchConditions;
        }
      }
    }

    // Calculate total valid and invalid counts (across all pages, independent of validity filter)
    // Total should be calculated from baseWhere (without validity filters) to show all contacts
    // FilteredTotal is for pagination (with validity filters applied)
    const [total, filteredTotal, totalValid, totalInvalid, contacts] = await this.prisma.$transaction([
      // Total all contacts (without validity filters) - for display
      this.prisma.contact.count({ where: baseWhere }),
      // Filtered total (with validity filters) - for pagination
      this.prisma.contact.count({ where }),
      // Total valid: (Valid email OR Valid phone) AND (No website OR website is valid)
      // Valid = (email exists AND emailValid === true) OR (phone exists) AND (no website OR websiteValid === true)
      this.prisma.contact.count({
        where: {
          ...baseWhere,
          AND: [
            {
              // Primary condition: Valid email OR Valid phone
              OR: [
                {
                  // Valid email: email exists AND emailValid === true
                  AND: [
                    { email: { not: null } },
                    { email: { not: '' } },
                    { emailValid: true },
                  ],
                },
                {
                  // Valid phone: phone exists (length validation done in computeContactValidity)
                  AND: [
                    { phone: { not: null } },
                    { phone: { not: '' } },
                  ],
                },
              ],
            },
            {
              // Website condition: no website OR website is valid
              OR: [
                {
                  OR: [
                    { website: null },
                    { website: { equals: '' } },
                  ],
                },
                { websiteValid: true },
              ],
            },
          ],
        },
      }),
      // Total invalid: (No valid email AND No valid phone) OR (Website exists AND website is invalid)
      this.prisma.contact.count({
        where: {
          ...baseWhere,
          OR: [
            {
              // Condition 1: No valid email AND No valid phone
              AND: [
                {
                  OR: [
                    { email: null },
                    { email: { equals: '' } },
                    { emailValid: false },
                  ],
                },
                {
                  OR: [
                    { phone: null },
                    { phone: { equals: '' } },
                  ],
                },
              ],
            },
            {
              // Condition 2: Website exists AND website is invalid
              AND: [
                { website: { not: null } },
                { website: { not: '' } },
                { websiteValid: false },
              ],
            },
          ],
        },
      }),
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
        total, // All contacts (for display card)
        totalPages: Math.ceil(filteredTotal / limit) || 1, // Based on filtered results
        totalValid,
        totalInvalid,
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

    // Normalize the update payload
    const normalizedEmail = this.normalizeNullableField(dto.email);
    const normalizedWebsite = this.normalizeNullableField(dto.website);
    const payload = this.normalizeContactUpdate(dto);

    // Update the contact fields first
    await this.prisma.contact.update({
      where: { id: contactId },
      data: payload,
    });

    // If email or website was updated, trigger full contact validation
    // This validates website, email, business name, and updates all related fields:
    // - emailValid, websiteValid, businessNameValid
    // - valid, validationReason
    // - scrapeMethod, scrapePriority
    // - status
    // Same comprehensive validation as after CSV upload
    if (normalizedEmail !== undefined || normalizedWebsite !== undefined) {
      // Trigger full contact validation (validates everything and updates all validation-related fields)
      await this.validationService.validateContact(contactId);
    }

    // Get the updated contact with all relations
    const updated = await this.prisma.contact.findUnique({
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

    if (!updated) {
      throw new NotFoundException(`Contact with ID ${contactId} not found after update`);
    }

    return this.mapContact(updated);
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

  /**
   * Bulk delete all invalid contacts for a client
   * Invalid contacts are those that meet ANY of these conditions:
   * 1. No valid email AND no valid phone
   * 2. Website is present but invalid (websiteValid === false)
   * Uses raw SQL for performance (single DELETE with JOIN)
   * Returns the count of deleted records
   */
  async bulkDeleteInvalidContacts(clientId: number): Promise<{ deletedCount: number }> {
    // First, count how many will be deleted
    // Invalid contacts: (No valid email AND No valid phone) OR (Website exists AND website is invalid)
    const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Contact" c
      INNER JOIN "CsvUpload" cu ON c."csvUploadId" = cu.id
      WHERE cu."clientId" = ${clientId}
        AND (
          (
            (c.email IS NULL OR c.email = '' OR c."emailValid" = false)
            AND (c.phone IS NULL OR c.phone = '')
          )
          OR (
            c.website IS NOT NULL
            AND c.website != ''
            AND c."websiteValid" = false
          )
        )
    `;

    const count = Number(countResult[0]?.count || 0);

    if (count === 0) {
      return { deletedCount: 0 };
    }

    // Single DELETE query with JOIN - database-optimized
    // Note: Prisma doesn't support DELETE with JOIN directly, so we use raw SQL
    await this.prisma.$executeRaw`
      DELETE FROM "Contact" c
      USING "CsvUpload" cu
      WHERE c."csvUploadId" = cu.id
        AND cu."clientId" = ${clientId}
        AND (
          (
            (c.email IS NULL OR c.email = '' OR c."emailValid" = false)
            AND (c.phone IS NULL OR c.phone = '')
          )
          OR (
            c.website IS NOT NULL
            AND c.website != ''
            AND c."websiteValid" = false
          )
        )
    `;

    return { deletedCount: count };
  }

  /**
   * Delete a single contact by ID
   * Verifies the contact belongs to the client before deleting
   */
  async deleteContact(clientId: number, contactId: number): Promise<{ deleted: boolean }> {
    // First verify the contact belongs to the client
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        csvUpload: {
          clientId,
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found or access denied`);
    }

    // Delete the contact
    await this.prisma.contact.delete({
      where: { id: contactId },
    });

    return { deleted: true };
  }
}
