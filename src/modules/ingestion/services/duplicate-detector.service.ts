import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/services/prisma.service';
import { Contact, DuplicateStatus } from '@prisma/client';

export interface DuplicateCheckResult {
  status: DuplicateStatus;
  reason?: string;
  matchingContactId?: number;
}

@Injectable()
export class DuplicateDetectorService {
  constructor(private readonly prisma: PrismaService) {}

  async detectDuplicates(newContact: Contact, clientId: number): Promise<DuplicateCheckResult> {
    // Get existing contacts for this client
    const existingContacts = await this.prisma.contact.findMany({
      where: { clientId },
      select: {
        id: true,
        email: true,
        website: true,
        businessName: true,
        phone: true,
      },
    });

    // Check for confirmed duplicates
    const confirmedDuplicate = this.checkConfirmedDuplicates(newContact, existingContacts);
    if (confirmedDuplicate) {
      return {
        status: 'confirmed_duplicate',
        reason: confirmedDuplicate.reason,
        matchingContactId: confirmedDuplicate.contactId,
      };
    }

    // Check for potential duplicates
    const potentialDuplicate = this.checkPotentialDuplicates(newContact, existingContacts);
    if (potentialDuplicate) {
      return {
        status: 'potential_duplicate',
        reason: potentialDuplicate.reason,
        matchingContactId: potentialDuplicate.contactId,
      };
    }

    return {
      status: 'unique',
    };
  }

  private checkConfirmedDuplicates(
    newContact: Contact,
    existingContacts: Array<{
      id: number;
      email: string | null;
      website: string | null;
      businessName: string;
      phone: string | null;
    }>
  ): { contactId: number; reason: string } | null {
    for (const existing of existingContacts) {
      // Same normalized website
      if (newContact.website && existing.website) {
        const normalizedNewWebsite = this.normalizeWebsite(newContact.website);
        const normalizedExistingWebsite = this.normalizeWebsite(existing.website);
        
        if (normalizedNewWebsite === normalizedExistingWebsite) {
          return {
            contactId: existing.id,
            reason: `Same website: ${normalizedNewWebsite}`,
          };
        }
      }

      // Same normalized email
      if (newContact.email && existing.email) {
        const normalizedNewEmail = this.normalizeEmail(newContact.email);
        const normalizedExistingEmail = this.normalizeEmail(existing.email);
        
        if (normalizedNewEmail === normalizedExistingEmail) {
          return {
            contactId: existing.id,
            reason: `Same email: ${normalizedNewEmail}`,
          };
        }
      }
    }

    return null;
  }

  private checkPotentialDuplicates(
    newContact: Contact,
    existingContacts: Array<{
      id: number;
      email: string | null;
      website: string | null;
      businessName: string;
      phone: string | null;
    }>
  ): { contactId: number; reason: string } | null {
    for (const existing of existingContacts) {
      // Same business name with different contact info
      if (newContact.businessName && existing.businessName) {
        const normalizedNewBusinessName = this.normalizeBusinessName(newContact.businessName);
        const normalizedExistingBusinessName = this.normalizeBusinessName(existing.businessName);
        
        if (normalizedNewBusinessName === normalizedExistingBusinessName) {
          // Check if contact info is different
          const hasDifferentContactInfo = 
            newContact.email !== existing.email ||
            newContact.phone !== existing.phone ||
            newContact.website !== existing.website;

          if (hasDifferentContactInfo) {
            return {
              contactId: existing.id,
              reason: `Same business name with different contact info: ${normalizedNewBusinessName}`,
            };
          }
        }
      }

      // Same phone number with different details
      if (newContact.phone && existing.phone) {
        const normalizedNewPhone = this.normalizePhone(newContact.phone);
        const normalizedExistingPhone = this.normalizePhone(existing.phone);
        
        if (normalizedNewPhone === normalizedExistingPhone) {
          // Check if other details are different
          const hasDifferentDetails = 
            newContact.businessName !== existing.businessName ||
            newContact.email !== existing.email ||
            newContact.website !== existing.website;

          if (hasDifferentDetails) {
            return {
              contactId: existing.id,
              reason: `Same phone number with different details: ${normalizedNewPhone}`,
            };
          }
        }
      }
    }

    return null;
  }

  private normalizeWebsite(website: string): string {
    return website.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  private normalizeBusinessName(businessName: string): string {
    return businessName.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }
}
