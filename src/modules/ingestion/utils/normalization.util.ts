export class NormalizationUtil {
  /**
   * Normalizes business name for consistent processing
   */
  static normalizeBusinessName(name: string): string {
    if (!name || typeof name !== 'string') {
      return '';
    }

    return name
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/[^\w\s\-&.,'()]/g, '') // Remove special characters except common business name chars
      .replace(
        /\b(LLC|Inc|Corp|Ltd|Co|Company|Business|Corporation|Limited)\b/gi,
        '',
      ) // Remove common suffixes
      .trim();
  }

  /**
   * Normalizes email address
   */
  static normalizeEmail(email: string): string {
    if (!email || typeof email !== 'string') {
      return '';
    }

    return email.trim().toLowerCase();
  }

  /**
   * Normalizes phone number
   */
  static normalizePhone(phone: string): string {
    if (!phone || typeof phone !== 'string') {
      return '';
    }

    // Remove all non-digit characters except + at the beginning
    let normalized = phone.replace(/[^\d+]/g, '');

    // Remove leading + if it's not followed by country code
    if (normalized.startsWith('+') && normalized.length < 10) {
      normalized = normalized.substring(1);
    }

    return normalized.trim();
  }

  /**
   * Normalizes website URL
   */
  static normalizeWebsite(website: string): string {
    if (!website || typeof website !== 'string') {
      return '';
    }

    let normalized = website.trim().toLowerCase();

    // Add protocol if missing
    if (
      !normalized.startsWith('http://') &&
      !normalized.startsWith('https://')
    ) {
      normalized = 'https://' + normalized;
    }

    // Remove www. prefix for consistency
    normalized = normalized.replace(/^https?:\/\/www\./, 'https://');

    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * Normalizes state/province name
   */
  static normalizeStateProvince(state: string): string {
    if (!state || typeof state !== 'string') {
      return '';
    }

    return state.trim().replace(/\s+/g, ' ');
  }

  /**
   * Normalizes ZIP/postal code
   */
  static normalizeZip(zip: string): string {
    if (!zip || typeof zip !== 'string') {
      return '';
    }

    return zip.trim().replace(/\s+/g, '').toUpperCase();
  }

  /**
   * Normalizes country name
   */
  static normalizeCountry(country: string): string {
    if (!country || typeof country !== 'string') {
      return '';
    }

    return country.trim().replace(/\s+/g, ' ');
  }

  /**
   * Normalizes text for duplicate detection
   */
  static normalizeForDuplicateDetection(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }

  /**
   * Normalizes business name for duplicate detection
   */
  static normalizeBusinessNameForDuplicates(name: string): string {
    const normalized = this.normalizeForDuplicateDetection(name);

    // Remove common business suffixes and words
    const suffixesToRemove = [
      'llc',
      'inc',
      'corp',
      'ltd',
      'co',
      'company',
      'business',
      'corporation',
      'limited',
      'enterprises',
      'group',
      'associates',
      'partners',
      'consulting',
      'services',
      'solutions',
      'systems',
    ];

    let result = normalized;
    suffixesToRemove.forEach((suffix) => {
      const regex = new RegExp(`\\b${suffix}\\b`, 'gi');
      result = result.replace(regex, '');
    });

    return result.replace(/\s+/g, ' ').trim();
  }

  /**
   * Normalizes phone number for duplicate detection
   */
  static normalizePhoneForDuplicates(phone: string): string {
    const normalized = this.normalizePhone(phone);

    // Remove country code if it's US/Canada (+1)
    if (normalized.startsWith('1') && normalized.length === 11) {
      return normalized.substring(1);
    }

    return normalized;
  }

  /**
   * Normalizes website URL for duplicate detection
   */
  static normalizeWebsiteForDuplicates(website: string): string {
    const normalized = this.normalizeWebsite(website);

    try {
      const url = new URL(normalized);
      return url.hostname.toLowerCase();
    } catch {
      return normalized;
    }
  }

  /**
   * Creates a hash for duplicate detection
   */
  static createDuplicateHash(data: {
    businessName?: string;
    email?: string;
    website?: string;
    phone?: string;
  }): string {
    const normalizedData = {
      businessName: data.businessName
        ? this.normalizeBusinessNameForDuplicates(data.businessName)
        : '',
      email: data.email ? this.normalizeEmail(data.email) : '',
      website: data.website
        ? this.normalizeWebsiteForDuplicates(data.website)
        : '',
      phone: data.phone ? this.normalizePhoneForDuplicates(data.phone) : '',
    };

    // Create a deterministic hash from normalized data
    const hashString = Object.values(normalizedData)
      .filter((value) => value.length > 0)
      .sort()
      .join('|');

    return this.simpleHash(hashString);
  }

  /**
   * Simple hash function for duplicate detection
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Validates normalized data
   */
  static validateNormalizedData(data: {
    businessName?: string;
    email?: string;
    website?: string;
    phone?: string;
  }): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (data.businessName && data.businessName.length < 2) {
      errors.push('Business name is too short');
    }

    if (data.email && !this.isValidEmailFormat(data.email)) {
      errors.push('Invalid email format');
    }

    if (data.website && !this.isValidWebsiteFormat(data.website)) {
      errors.push('Invalid website format');
    }

    if (data.phone && data.phone.length < 10) {
      errors.push('Phone number is too short');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates email format
   */
  private static isValidEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates website format
   */
  private static isValidWebsiteFormat(website: string): boolean {
    try {
      new URL(website);
      return true;
    } catch {
      return false;
    }
  }
}
