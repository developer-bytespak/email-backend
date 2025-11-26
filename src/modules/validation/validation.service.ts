import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import * as dns from 'dns';
import { promisify } from 'util';
import * as net from 'net';

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
    // IMPORTANT: If website is provided but invalid, contact is invalid (force user to fix it)
    // Otherwise, contact is valid if ANY ONE of these is valid
    let isValid: boolean;
    if (contact.website && !websiteValid) {
      // Website provided but invalid - mark as invalid to force user to fix it
      isValid = false;
    } else {
      // Contact is valid if ANY ONE of these is valid
      isValid = websiteValid || emailValid || businessNameValid;
    }

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
      isValid,
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
    isValid: boolean,
  ): string {
    // If website is provided but invalid, that's the primary reason for invalidity
    if (website && !websiteValid) {
      return 'Website is unreachable - please update or remove the website URL';
    }

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
   * Validate email address with syntax, MX records, and mailbox existence check
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
      let mxRecords;
      try {
        mxRecords = await resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) {
          this.logger.debug(`No MX records found for: ${domain}`);
          return false;
        }
        this.logger.debug(`MX records found for ${domain}: ${mxRecords.length} records`);
      } catch (error) {
        this.logger.debug(`MX lookup failed for ${domain}: ${error.message}`);
        return false;
      }

      // 4. Check if free email provider (skip SMTP handshake for these)
      const isFreeEmail = this.freeEmailProviders.has(domain);
      if (isFreeEmail) {
        // Free providers often block SMTP verification, so we trust MX records
        this.logger.debug(`Free email provider detected: ${domain}, skipping SMTP handshake`);
        return true;
      }

      // 5. SMTP handshake to verify mailbox existence (for business domains only)
      try {
        const mailboxExists = await this.verifyMailboxExists(email, mxRecords);
        if (mailboxExists) {
          this.logger.debug(`Email mailbox verified: ${email}`);
          return true;
        } else {
          this.logger.debug(`Email mailbox does not exist: ${email}`);
          return false;
        }
      } catch (error) {
        // If SMTP handshake fails, fall back to MX records only
        this.logger.debug(`SMTP handshake failed for ${email}: ${error.message}, falling back to MX records`);
        return true; // Trust MX records if SMTP fails (some servers block verification)
      }
    } catch (error) {
      this.logger.error(`Email validation error: ${error.message}`);
      return false;
    }
  }

  /**
   * Verify mailbox existence using SMTP handshake (free method)
   * Only works for servers that allow VRFY/RCPT TO verification
   */
  private async verifyMailboxExists(
    email: string,
    mxRecords: Array<{ exchange: string; priority: number }>,
  ): Promise<boolean> {
    // Sort MX records by priority (lower is better)
    const sortedMx = [...mxRecords].sort((a, b) => a.priority - b.priority);
    const [localPart, domain] = email.split('@');

    // Try up to 3 MX servers (to avoid timeout issues)
    const maxAttempts = Math.min(3, sortedMx.length);

    for (let i = 0; i < maxAttempts; i++) {
      const mxRecord = sortedMx[i];
      const mxHost = mxRecord.exchange;

      try {
        const exists = await this.smtpHandshake(mxHost, email, localPart, domain);
        if (exists !== null) {
          // Got a definitive answer
          return exists;
        }
        // If null, try next MX server
      } catch (error) {
        this.logger.debug(`SMTP handshake failed for ${mxHost}: ${error.message}`);
        // Continue to next MX server
      }
    }

    // If all attempts failed or returned null, assume valid (fallback to MX records)
    return true;
  }

  /**
   * Perform SMTP handshake to check mailbox existence
   * Returns: true (exists), false (doesn't exist), null (indeterminate)
   */
  private async smtpHandshake(
    mxHost: string,
    email: string,
    localPart: string,
    domain: string,
  ): Promise<boolean | null> {
    return new Promise((resolve, reject) => {
      const timeout = 8000; // 8 second timeout
      const socket = new net.Socket();
      let step = 0; // Track SMTP conversation step
      let dataBuffer = '';

      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null); // Timeout = indeterminate
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        if (!socket.destroyed) {
          socket.destroy();
        }
      };

      socket.on('data', (data: Buffer) => {
        dataBuffer += data.toString();
        const lines = dataBuffer.split(/\r?\n/);
        dataBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          const code = parseInt(line.substring(0, 3), 10);
          if (isNaN(code)) continue;

          // Step 0: Wait for greeting (220)
          if (step === 0 && code === 220) {
            step = 1;
            socket.write(`HELO ${domain}\r\n`);
          }
          // Step 1: HELO response (250)
          else if (step === 1 && code === 250) {
            step = 2;
            // Try RCPT TO directly (more reliable than VRFY)
            socket.write(`MAIL FROM:<noreply@${domain}>\r\n`);
          }
          // Step 2: MAIL FROM response (250)
          else if (step === 2 && code === 250) {
            step = 3;
            socket.write(`RCPT TO:<${email}>\r\n`);
          }
          // Step 3: RCPT TO response
          else if (step === 3) {
            if (code === 250) {
              // Mailbox exists
              cleanup();
              resolve(true);
              return;
            } else if (code === 550 || code === 551 || code === 553) {
              // Mailbox doesn't exist
              cleanup();
              resolve(false);
              return;
            } else {
              // Other response (indeterminate)
              cleanup();
              resolve(null);
              return;
            }
          }
        }
      });

      socket.on('error', (error: Error) => {
        cleanup();
        resolve(null); // Network error = indeterminate
      });

      socket.on('close', () => {
        cleanup();
        // If we didn't get a definitive answer, it's indeterminate
        resolve(null);
      });

      // Connect to SMTP server (port 25)
      socket.connect(25, mxHost);
    });
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

