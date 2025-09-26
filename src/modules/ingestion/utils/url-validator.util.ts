export interface UrlValidationResult {
  isValid: boolean;
  normalizedUrl?: string;
  error?: string;
  isAccessible?: boolean;
}

export class UrlValidatorUtil {
  private static readonly urlRegex =
    /^https?:\/\/(?:[-\w.])+(?:\:[0-9]+)?(?:\/(?:[\w\/_.])*(?:\?(?:[\w&=%.])*)?(?:\#(?:[\w.])*)?)?$/i;

  /**
   * Validates URL format
   */
  static validateUrlFormat(url: string): UrlValidationResult {
    if (!url || typeof url !== 'string') {
      return {
        isValid: false,
        error: 'URL is required',
      };
    }

    const trimmed = url.trim();
    if (trimmed.length === 0) {
      return {
        isValid: false,
        error: 'URL cannot be empty',
      };
    }

    // Try to normalize the URL first
    const normalized = this.normalizeUrl(trimmed);

    if (!this.urlRegex.test(normalized)) {
      return {
        isValid: false,
        error: 'Invalid URL format',
      };
    }

    return {
      isValid: true,
      normalizedUrl: normalized,
    };
  }

  /**
   * Normalizes URL format
   */
  static normalizeUrl(url: string): string {
    let normalized = url.trim().toLowerCase();

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

    // Remove trailing query parameters and fragments for basic validation
    normalized = normalized.split('?')[0].split('#')[0];

    return normalized;
  }

  /**
   * Extracts domain from URL
   */
  static extractDomain(url: string): string | null {
    try {
      const normalized = this.normalizeUrl(url);
      const urlObj = new URL(normalized);
      return urlObj.hostname;
    } catch (error) {
      return null;
    }
  }

  /**
   * Checks if URL is likely a business website
   */
  static isBusinessWebsite(url: string): boolean {
    const domain = this.extractDomain(url);
    if (!domain) return false;

    // Check for common non-business domains
    const nonBusinessPatterns = [
      /facebook\.com/i,
      /twitter\.com/i,
      /instagram\.com/i,
      /linkedin\.com/i,
      /youtube\.com/i,
      /tiktok\.com/i,
      /pinterest\.com/i,
      /reddit\.com/i,
      /github\.com/i,
      /stackoverflow\.com/i,
      /wikipedia\.org/i,
      /amazon\.com/i,
      /ebay\.com/i,
      /craigslist\.org/i,
    ];

    return !nonBusinessPatterns.some((pattern) => pattern.test(domain));
  }

  /**
   * Validates URL accessibility (simplified check)
   */
  static async validateUrlAccessibility(
    url: string,
  ): Promise<UrlValidationResult> {
    const formatResult = this.validateUrlFormat(url);
    if (!formatResult.isValid) {
      return formatResult;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(formatResult.normalizedUrl!, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EmailSystemBot/1.0)',
        },
      });

      clearTimeout(timeoutId);

      return {
        isValid: response.ok,
        normalizedUrl: formatResult.normalizedUrl,
        isAccessible: response.ok,
        error: response.ok
          ? undefined
          : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (error) {
      return {
        isValid: false,
        normalizedUrl: formatResult.normalizedUrl,
        isAccessible: false,
        error: `Accessibility check failed: ${error.message}`,
      };
    }
  }

  /**
   * Checks if URL is from a free hosting service
   */
  static isFreeHosting(url: string): boolean {
    const domain = this.extractDomain(url);
    if (!domain) return false;

    const freeHostingPatterns = [
      /wordpress\.com/i,
      /blogspot\.com/i,
      /wix\.com/i,
      /squarespace\.com/i,
      /weebly\.com/i,
      /tumblr\.com/i,
      /medium\.com/i,
      /substack\.com/i,
      /ghost\.org/i,
      /\.wordpress\.com$/i,
      /\.blogspot\.com$/i,
      /\.wixsite\.com$/i,
      /\.squarespace\.com$/i,
      /\.weebly\.com$/i,
      /\.tumblr\.com$/i,
    ];

    return freeHostingPatterns.some((pattern) => pattern.test(domain));
  }

  /**
   * Gets URL category for business analysis
   */
  static getUrlCategory(
    url: string,
  ): 'business' | 'social' | 'ecommerce' | 'free_hosting' | 'unknown' {
    const domain = this.extractDomain(url);
    if (!domain) return 'unknown';

    if (this.isFreeHosting(url)) {
      return 'free_hosting';
    }

    // Social media patterns
    const socialPatterns = [
      /facebook\.com/i,
      /twitter\.com/i,
      /instagram\.com/i,
      /linkedin\.com/i,
      /youtube\.com/i,
      /tiktok\.com/i,
      /pinterest\.com/i,
      /reddit\.com/i,
    ];

    if (socialPatterns.some((pattern) => pattern.test(domain))) {
      return 'social';
    }

    // E-commerce patterns
    const ecommercePatterns = [
      /amazon\.com/i,
      /ebay\.com/i,
      /shopify\.com/i,
      /etsy\.com/i,
      /alibaba\.com/i,
      /walmart\.com/i,
      /target\.com/i,
    ];

    if (ecommercePatterns.some((pattern) => pattern.test(domain))) {
      return 'ecommerce';
    }

    return 'business';
  }

  /**
   * Sanitizes URL for safe storage
   */
  static sanitizeUrl(url: string): string {
    return this.normalizeUrl(url)
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .substring(0, 500); // Limit length
  }
}
