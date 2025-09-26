import { Contact } from '@prisma/client';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  inferredWebsite?: string;
}

export interface ProcessingStrategy {
  /**
   * Validate a contact based on the plan's requirements
   */
  validateContact(contact: Contact): Promise<ValidationResult>;

  /**
   * Resolve website URL for the contact
   */
  resolveWebsite(contact: Contact): Promise<string | null>;

  /**
   * Check if website processing should be performed
   */
  shouldProcessWebsite(contact: Contact): boolean;

  /**
   * Get the plan name for this strategy
   */
  getPlanName(): string;

  /**
   * Get processing features for this strategy
   */
  getFeatures(): {
    websiteResolution: boolean;
    googleSearchAPI: boolean;
    emailValidation: boolean;
    businessNameResolution: boolean;
  };
}
