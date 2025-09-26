import { Injectable } from '@nestjs/common';

export interface EmailValidationResult {
  isValid: boolean;
  reason?: string;
  domain?: string;
  isFreeEmail?: boolean;
}

@Injectable()
export class EmailValidatorService {
  private readonly emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private readonly freeEmailDomains = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'protonmail.com', 'icloud.com', 'aol.com', 'live.com',
    'msn.com', 'zoho.com', 'mail.com', 'yandex.com',
    'gmx.com', 'web.de', 'tutanota.com', 'fastmail.com'
  ];

  /**
   * Validates email format and domain
   */
  async validateEmail(email: string): Promise<EmailValidationResult> {
    if (!email || typeof email !== 'string') {
      return {
        isValid: false,
        reason: 'Email is required'
      };
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check basic format
    if (!this.emailRegex.test(trimmedEmail)) {
      return {
        isValid: false,
        reason: 'Invalid email format'
      };
    }

    // Extract domain
    const domain = this.extractDomain(trimmedEmail);
    if (!domain) {
      return {
        isValid: false,
        reason: 'Invalid email domain'
      };
    }

    // Check if it's a free email domain
    const isFreeEmail = this.isFreeEmailDomain(domain);
    if (isFreeEmail) {
      return {
        isValid: false,
        reason: 'Free email domains are not allowed',
        domain,
        isFreeEmail: true
      };
    }

    // Validate domain exists (DNS MX record check)
    const domainExists = await this.validateDomainExists(domain);
    if (!domainExists) {
      return {
        isValid: false,
        reason: 'Email domain does not exist',
        domain,
        isFreeEmail: false
      };
    }

    return {
      isValid: true,
      domain,
      isFreeEmail: false
    };
  }

  /**
   * Validates multiple emails and returns results
   */
  async validateEmails(emails: string[]): Promise<EmailValidationResult[]> {
    const results = await Promise.all(
      emails.map(email => this.validateEmail(email))
    );
    return results;
  }

  /**
   * Checks if email domain has MX records
   */
  private async validateDomainExists(domain: string): Promise<boolean> {
    try {
      // This is a simplified check - in production, you'd use a proper DNS library
      // For now, we'll assume all non-free domains exist
      // In a real implementation, you'd use something like:
      // const dns = require('dns').promises;
      // const mxRecords = await dns.resolveMx(domain);
      // return mxRecords.length > 0;
      
      return true; // Placeholder - implement actual DNS lookup
    } catch (error) {
      return false;
    }
  }

  /**
   * Extracts domain from email address
   */
  private extractDomain(email: string): string | null {
    const parts = email.split('@');
    return parts.length === 2 ? parts[1] : null;
  }

  /**
   * Checks if domain is a free email provider
   */
  private isFreeEmailDomain(domain: string): boolean {
    return this.freeEmailDomains.includes(domain.toLowerCase());
  }

  /**
   * Normalizes email address
   */
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Gets list of free email domains
   */
  getFreeEmailDomains(): string[] {
    return [...this.freeEmailDomains];
  }

  /**
   * Checks if an email is from a free provider
   */
  isFreeEmail(email: string): boolean {
    const domain = this.extractDomain(email);
    return domain ? this.isFreeEmailDomain(domain) : false;
  }
}
