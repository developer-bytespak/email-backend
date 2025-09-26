export interface DomainExtractionResult {
  domain?: string;
  isValid: boolean;
  isFreeEmail?: boolean;
  error?: string;
}

export class DomainExtractorUtil {
  private static readonly emailRegex = /^[^\s@]+@([^\s@]+)$/;
  private static readonly freeEmailDomains = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'protonmail.com', 'icloud.com', 'aol.com', 'live.com',
    'msn.com', 'zoho.com', 'mail.com', 'yandex.com',
    'gmx.com', 'web.de', 'tutanota.com', 'fastmail.com',
    'mail.ru', 'qq.com', '163.com', '126.com'
  ];

  /**
   * Extracts domain from email address
   */
  static extractDomainFromEmail(email: string): DomainExtractionResult {
    if (!email || typeof email !== 'string') {
      return {
        isValid: false,
        error: 'Email is required'
      };
    }

    const trimmed = email.trim().toLowerCase();
    const match = trimmed.match(this.emailRegex);

    if (!match) {
      return {
        isValid: false,
        error: 'Invalid email format'
      };
    }

    const domain = match[1];
    const isFreeEmail = this.isFreeEmailDomain(domain);

    return {
      domain,
      isValid: true,
      isFreeEmail
    };
  }

  /**
   * Checks if domain is a free email provider
   */
  static isFreeEmailDomain(domain: string): boolean {
    return this.freeEmailDomains.includes(domain.toLowerCase());
  }

  /**
   * Converts email domain to potential website URL
   */
  static domainToWebsiteUrl(domain: string): string {
    const normalizedDomain = domain.toLowerCase().trim();
    
    // Add protocol
    return `https://${normalizedDomain}`;
  }

  /**
   * Extracts multiple domains from email list
   */
  static extractDomainsFromEmails(emails: string[]): DomainExtractionResult[] {
    return emails.map(email => this.extractDomainFromEmail(email));
  }

  /**
   * Gets unique domains from email list
   */
  static getUniqueDomains(emails: string[]): string[] {
    const domains = new Set<string>();
    
    emails.forEach(email => {
      const result = this.extractDomainFromEmail(email);
      if (result.isValid && result.domain) {
        domains.add(result.domain);
      }
    });

    return Array.from(domains);
  }

  /**
   * Filters out free email domains
   */
  static filterBusinessDomains(emails: string[]): string[] {
    return emails.filter(email => {
      const result = this.extractDomainFromEmail(email);
      return result.isValid && result.domain && !result.isFreeEmail;
    });
  }

  /**
   * Validates domain format
   */
  static validateDomainFormat(domain: string): boolean {
    if (!domain || typeof domain !== 'string') {
      return false;
    }

    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainRegex.test(domain);
  }

  /**
   * Normalizes domain name
   */
  static normalizeDomain(domain: string): string {
    return domain.toLowerCase().trim();
  }

  /**
   * Checks if domain looks like a business domain
   */
  static isBusinessDomain(domain: string): boolean {
    const normalized = this.normalizeDomain(domain);
    
    // Skip free email domains
    if (this.isFreeEmailDomain(normalized)) {
      return false;
    }

    // Check for common business patterns
    const businessPatterns = [
      /\.com$/i,
      /\.org$/i,
      /\.net$/i,
      /\.co\./i,
      /\.biz$/i,
      /\.info$/i
    ];

    return businessPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Extracts subdomain from domain
   */
  static extractSubdomain(domain: string): string | null {
    const parts = domain.split('.');
    if (parts.length > 2) {
      return parts[0];
    }
    return null;
  }

  /**
   * Gets root domain (removes subdomain)
   */
  static getRootDomain(domain: string): string {
    const parts = domain.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return domain;
  }

  /**
   * Checks if two domains are related (same root domain)
   */
  static areRelatedDomains(domain1: string, domain2: string): boolean {
    const root1 = this.getRootDomain(domain1);
    const root2 = this.getRootDomain(domain2);
    return root1 === root2;
  }

  /**
   * Gets list of free email domains
   */
  static getFreeEmailDomains(): string[] {
    return [...this.freeEmailDomains];
  }

  /**
   * Estimates domain credibility score
   */
  static getDomainCredibilityScore(domain: string): number {
    let score = 0;
    const normalized = this.normalizeDomain(domain);

    // Penalty for free email domains
    if (this.isFreeEmailDomain(normalized)) {
      return 0;
    }

    // Bonus for common business TLDs
    if (/\.com$/i.test(normalized)) score += 3;
    else if (/\.org$/i.test(normalized)) score += 2;
    else if (/\.net$/i.test(normalized)) score += 2;
    else if (/\.co\./i.test(normalized)) score += 2;
    else score += 1;

    // Bonus for shorter domains (more premium)
    if (normalized.length < 10) score += 2;
    else if (normalized.length < 15) score += 1;

    // Penalty for numbers in domain
    if (/\d/.test(normalized)) score -= 1;

    // Penalty for hyphens
    if (/-/.test(normalized)) score -= 1;

    return Math.max(0, Math.min(10, score));
  }
}
