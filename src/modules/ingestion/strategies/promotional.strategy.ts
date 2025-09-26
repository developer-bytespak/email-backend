import { Injectable } from '@nestjs/common';
import { Contact } from '@prisma/client';
import {
  ProcessingStrategy,
  ValidationResult,
} from './processing-strategy.interface';

@Injectable()
export class PromotionalStrategy implements ProcessingStrategy {
  getPlanName(): string {
    return 'promotional';
  }

  getFeatures() {
    return {
      websiteResolution: false,
      googleSearchAPI: false,
      emailValidation: true,
      businessNameResolution: false,
    };
  }

  async validateContact(contact: Contact): Promise<ValidationResult> {
    // Promotional plan: Email validation only
    const validation = this.validateEmail(contact.email);

    if (!validation.isValid) {
      return {
        isValid: false,
        reason: validation.reason,
      };
    }

    return {
      isValid: true,
    };
  }

  async resolveWebsite(contact: Contact): Promise<string | null> {
    // Promotional plan: Skip website resolution
    return null;
  }

  shouldProcessWebsite(contact: Contact): boolean {
    // Promotional plan: Never process websites
    return false;
  }

  private validateEmail(email: string | null): ValidationResult {
    if (!email) {
      return {
        isValid: false,
        reason: 'Email is required for promotional plan',
      };
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        isValid: false,
        reason: 'Invalid email format',
      };
    }

    // Check for free email domains
    const freeEmailDomains = [
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'protonmail.com',
      'icloud.com',
      'aol.com',
      'live.com',
    ];

    const domain = email.split('@')[1]?.toLowerCase();
    if (freeEmailDomains.includes(domain)) {
      return {
        isValid: false,
        reason: 'Free email domains not allowed for promotional plan',
      };
    }

    return {
      isValid: true,
    };
  }
}
