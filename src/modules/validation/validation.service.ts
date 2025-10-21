import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import * as dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  // List of common disposable email domains
  private readonly disposableDomains = new Set([
    'tempmail.com',
    'guerrillamail.com',
    '10minutemail.com',
    'throwaway.email',
    'mailinator.com',
    'maildrop.cc',
  ]);

  // List of free email providers (personal, not business)
  private readonly freeEmailProviders = new Set([
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'aol.com',
    'icloud.com',
    'mail.com',
    'protonmail.com',
    'zoho.com',
    'yandex.com',
    'gmx.com',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate all contacts in a CSV upload
   */
  async validateUpload(csvUploadId: number): Promise<{
    total: number;
    validated: number;
    valid: number;
    invalid: number;
  }> {
    this.logger.log(`Starting validation for CSV upload ${csvUploadId}`);

    const contacts = await this.prisma.contact.findMany({
      where: { csvUploadId },
    });

    let validCount = 0;
    let invalidCount = 0;

    for (const contact of contacts) {
      const isValid = await this.validateContact(contact.id);
      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
      }
    }

    // Update CSV upload stats
    await this.prisma.csvUpload.update({
      where: { id: csvUploadId },
      data: {
        description: `Validation complete: ${validCount} valid, ${invalidCount} invalid`,
      },
    });

    this.logger.log(
      `Validation complete for upload ${csvUploadId}: ${validCount} valid, ${invalidCount} invalid`,
    );

    return {
      total: contacts.length,
      validated: contacts.length,
      valid: validCount,
      invalid: invalidCount,
    };
  }

  /**
   * Validate a single contact with enhanced logic
   */
  async validateContact(contactId: number): Promise<boolean> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      return false;
    }

    // Phase 1: Validate Website
    let websiteValid = false;
    if (contact.website) {
      websiteValid = await this.validateWebsite(contact.website);
    }

    // Phase 2: Validate Email
    let emailValid = false;
    let isFreeEmail = false;
    if (contact.email) {
      emailValid = await this.validateEmail(contact.email);
      
      // Check if it's a free email provider
      const domain = contact.email.split('@')[1]?.toLowerCase();
      isFreeEmail = this.freeEmailProviders.has(domain);
    }

    // Phase 3: Validate Business Name
    let businessNameValid = false;
    if (contact.businessName && contact.businessName.trim().length > 2) {
      businessNameValid = true;
    }

    // Determine overall validity
    // Contact is valid if ANY ONE of these is valid
    const isValid = websiteValid || emailValid || businessNameValid;

    // Determine scrape method and priority
    type ScrapeMethodType = 'direct_url' | 'email_domain' | 'business_search';
    let scrapeMethod: ScrapeMethodType | null = null;
    let scrapePriority: number | null = null;

    if (websiteValid) {
      scrapeMethod = 'direct_url';
      scrapePriority = 1;
    } else if (emailValid && !isFreeEmail) {
      // Use email domain ONLY if it's not a free provider
      scrapeMethod = 'email_domain';
      scrapePriority = 2;
    } else if (businessNameValid) {
      // Use business name search (includes case where email is free provider)
      scrapeMethod = 'business_search';
      scrapePriority = 3;
    }

    // Build validation reason
    const validationReason = this.buildValidationReason(
      websiteValid,
      emailValid,
      isFreeEmail,
      businessNameValid,
      contact.website || '',
      contact.email || '',
      contact.businessName || '',
    );

    // Update contact with all validation results
    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        websiteValid,
        emailValid,
        businessNameValid,
        valid: isValid,
        scrapeMethod,
        scrapePriority,
        status: isValid ? 'ready_to_scrape' : 'new',
        validationReason,
      },
    });

    this.logger.log(
      `Contact ${contactId} validated: ${isValid ? 'VALID' : 'INVALID'} - Method: ${scrapeMethod || 'none'}`,
    );

    return isValid;
  }

  /**
   * Build detailed validation reason
   */
  private buildValidationReason(
    websiteValid: boolean,
    emailValid: boolean,
    isFreeEmail: boolean,
    businessNameValid: boolean,
    website: string,
    email: string,
    businessName: string,
  ): string {
    // If everything is invalid
    if (!websiteValid && !emailValid && !businessNameValid) {
      return 'All validation methods failed: no valid website, email, or business name';
    }

    const valid: string[] = [];
    const invalid: string[] = [];

    // Website
    if (websiteValid) {
      valid.push('website (accessible)');
    } else if (website) {
      invalid.push('website (404/unreachable)');
    }

    // Email
    if (emailValid) {
      if (isFreeEmail) {
        valid.push('email (valid but free provider - using business name for search)');
      } else {
        valid.push('email (valid domain)');
      }
    } else if (email) {
      invalid.push('email (invalid format/domain)');
    }

    // Business Name
    if (businessNameValid) {
      valid.push('business name');
    } else if (businessName) {
      invalid.push('business name (too short)');
    }

    let reason = '';
    if (valid.length > 0) {
      reason += `Valid: ${valid.join(', ')}`;
    }
    if (invalid.length > 0) {
      reason += valid.length > 0 ? '. ' : '';
      reason += `Invalid: ${invalid.join(', ')}`;
    }

    return reason;
  }

  /**
   * Validate email address
   */
  async validateEmail(email: string): Promise<boolean> {
    try {
      // 1. Basic syntax validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        this.logger.debug(`Email syntax invalid: ${email}`);
        return false;
      }

      // 2. Check if disposable email
      const domain = email.split('@')[1].toLowerCase();
      if (this.disposableDomains.has(domain)) {
        this.logger.debug(`Disposable email detected: ${email}`);
        return false;
      }

      // 3. Check MX records (DNS lookup)
      try {
        const mxRecords = await resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) {
          this.logger.debug(`No MX records found for: ${domain}`);
          return false;
        }
        this.logger.debug(`Email valid: ${email} (${mxRecords.length} MX records)`);
        return true;
      } catch (error) {
        this.logger.debug(`MX lookup failed for ${domain}: ${error.message}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Email validation error: ${error.message}`);
      return false;
    }
  }

  /**
   * Validate website URL
   */
  async validateWebsite(url: string): Promise<boolean> {
    try {
      // Ensure URL has protocol
      let websiteUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        websiteUrl = `https://${url}`;
      }

      // Try to fetch the website
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      try {
        const response = await fetch(websiteUrl, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);

        // Accept any 2xx or 3xx status codes
        const isValid = response.status < 400;
        this.logger.debug(
          `Website ${websiteUrl} returned status ${response.status}: ${isValid ? 'valid' : 'invalid'}`,
        );
        return isValid;
      } catch (fetchError) {
        clearTimeout(timeout);
        this.logger.debug(`Website fetch failed for ${websiteUrl}: ${fetchError.message}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Website validation error: ${error.message}`);
      return false;
    }
  }

  /**
   * Re-validate contacts that previously failed
   */
  async revalidateInvalid(csvUploadId: number): Promise<number> {
    const invalidContacts = await this.prisma.contact.findMany({
      where: {
        csvUploadId,
        valid: false,
      },
    });

    let revalidatedCount = 0;

    for (const contact of invalidContacts) {
      const isNowValid = await this.validateContact(contact.id);
      if (isNowValid) {
        revalidatedCount++;
      }
    }

    this.logger.log(
      `Revalidation complete: ${revalidatedCount}/${invalidContacts.length} now valid`,
    );

    return revalidatedCount;
  }
}

