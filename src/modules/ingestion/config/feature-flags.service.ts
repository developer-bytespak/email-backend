import { Injectable } from '@nestjs/common';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  planRestrictions?: string[];
  environmentRestrictions?: string[];
}

@Injectable()
export class FeatureFlagsService {
  private readonly featureFlags: Map<string, FeatureFlag> = new Map();

  constructor() {
    this.initializeFeatureFlags();
  }

  /**
   * Initializes default feature flags
   */
  private initializeFeatureFlags(): void {
    const flags: FeatureFlag[] = [
      {
        name: 'website_resolution',
        enabled: process.env.FEATURE_WEBSITE_RESOLUTION !== 'false',
        description: 'Enable website resolution pipeline',
        planRestrictions: ['personal']
      },
      {
        name: 'google_search_api',
        enabled: process.env.FEATURE_GOOGLE_SEARCH_API !== 'false',
        description: 'Enable Google Search API integration',
        planRestrictions: ['personal']
      },
      {
        name: 'advanced_email_validation',
        enabled: process.env.FEATURE_ADVANCED_EMAIL_VALIDATION !== 'false',
        description: 'Enable advanced email validation with DNS lookup',
        planRestrictions: ['personal']
      },
      {
        name: 'business_name_resolution',
        enabled: process.env.FEATURE_BUSINESS_NAME_RESOLUTION !== 'false',
        description: 'Enable business name to website resolution',
        planRestrictions: ['personal']
      },
      {
        name: 'advanced_duplicate_detection',
        enabled: process.env.FEATURE_ADVANCED_DUPLICATE_DETECTION !== 'false',
        description: 'Enable advanced duplicate detection algorithms',
        planRestrictions: ['personal']
      },
      {
        name: 'external_api_calls',
        enabled: process.env.FEATURE_EXTERNAL_API_CALLS !== 'false',
        description: 'Enable external API calls for data enrichment',
        planRestrictions: ['personal']
      },
      {
        name: 'caching_enabled',
        enabled: process.env.FEATURE_CACHING !== 'false',
        description: 'Enable caching for improved performance',
        planRestrictions: ['personal', 'promotional']
      },
      {
        name: 'retry_logic',
        enabled: process.env.FEATURE_RETRY_LOGIC !== 'false',
        description: 'Enable retry logic for failed operations',
        planRestrictions: ['personal', 'promotional']
      },
      {
        name: 'circuit_breaker',
        enabled: process.env.FEATURE_CIRCUIT_BREAKER !== 'false',
        description: 'Enable circuit breaker for external services',
        planRestrictions: ['personal']
      },
      {
        name: 'rate_limiting',
        enabled: process.env.FEATURE_RATE_LIMITING !== 'false',
        description: 'Enable rate limiting for external APIs',
        planRestrictions: ['personal']
      },
      {
        name: 'detailed_logging',
        enabled: process.env.FEATURE_DETAILED_LOGGING !== 'false',
        description: 'Enable detailed logging for debugging',
        planRestrictions: ['personal', 'promotional']
      },
      {
        name: 'performance_metrics',
        enabled: process.env.FEATURE_PERFORMANCE_METRICS !== 'false',
        description: 'Enable performance metrics collection',
        planRestrictions: ['personal', 'promotional']
      }
    ];

    flags.forEach(flag => {
      this.featureFlags.set(flag.name, flag);
    });
  }

  /**
   * Checks if a feature is enabled
   */
  isFeatureEnabled(featureName: string, planName?: string, environment?: string): boolean {
    const flag = this.featureFlags.get(featureName);
    
    if (!flag) {
      return false;
    }

    // Check if feature is globally disabled
    if (!flag.enabled) {
      return false;
    }

    // Check plan restrictions
    if (planName && flag.planRestrictions && flag.planRestrictions.length > 0) {
      if (!flag.planRestrictions.includes(planName)) {
        return false;
      }
    }

    // Check environment restrictions
    if (environment && flag.environmentRestrictions && flag.environmentRestrictions.length > 0) {
      if (!flag.environmentRestrictions.includes(environment)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Gets all enabled features for a plan
   */
  getEnabledFeatures(planName: string, environment?: string): string[] {
    const enabledFeatures: string[] = [];

    this.featureFlags.forEach((flag, name) => {
      if (this.isFeatureEnabled(name, planName, environment)) {
        enabledFeatures.push(name);
      }
    });

    return enabledFeatures;
  }

  /**
   * Gets feature flag details
   */
  getFeatureFlag(featureName: string): FeatureFlag | undefined {
    return this.featureFlags.get(featureName);
  }

  /**
   * Gets all feature flags
   */
  getAllFeatureFlags(): FeatureFlag[] {
    return Array.from(this.featureFlags.values());
  }

  /**
   * Updates a feature flag
   */
  updateFeatureFlag(featureName: string, updates: Partial<FeatureFlag>): boolean {
    const flag = this.featureFlags.get(featureName);
    
    if (!flag) {
      return false;
    }

    const updatedFlag = { ...flag, ...updates };
    this.featureFlags.set(featureName, updatedFlag);
    
    return true;
  }

  /**
   * Enables a feature flag
   */
  enableFeature(featureName: string): boolean {
    return this.updateFeatureFlag(featureName, { enabled: true });
  }

  /**
   * Disables a feature flag
   */
  disableFeature(featureName: string): boolean {
    return this.updateFeatureFlag(featureName, { enabled: false });
  }

  /**
   * Checks if external APIs are enabled for a plan
   */
  areExternalApisEnabled(planName: string): boolean {
    return this.isFeatureEnabled('external_api_calls', planName);
  }

  /**
   * Checks if website resolution is enabled for a plan
   */
  isWebsiteResolutionEnabled(planName: string): boolean {
    return this.isFeatureEnabled('website_resolution', planName);
  }

  /**
   * Checks if Google Search API is enabled for a plan
   */
  isGoogleSearchEnabled(planName: string): boolean {
    return this.isFeatureEnabled('google_search_api', planName);
  }

  /**
   * Checks if advanced duplicate detection is enabled for a plan
   */
  isAdvancedDuplicateDetectionEnabled(planName: string): boolean {
    return this.isFeatureEnabled('advanced_duplicate_detection', planName);
  }

  /**
   * Gets feature capabilities for a plan
   */
  getPlanCapabilities(planName: string): {
    canResolveWebsites: boolean;
    canUseGoogleSearch: boolean;
    canValidateEmails: boolean;
    canResolveBusinessNames: boolean;
    canDetectDuplicates: boolean;
    canUseExternalApis: boolean;
  } {
    return {
      canResolveWebsites: this.isWebsiteResolutionEnabled(planName),
      canUseGoogleSearch: this.isGoogleSearchEnabled(planName),
      canValidateEmails: this.isFeatureEnabled('advanced_email_validation', planName),
      canResolveBusinessNames: this.isFeatureEnabled('business_name_resolution', planName),
      canDetectDuplicates: this.isAdvancedDuplicateDetectionEnabled(planName),
      canUseExternalApis: this.areExternalApisEnabled(planName)
    };
  }

  /**
   * Validates feature flag configuration
   */
  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    this.featureFlags.forEach((flag, name) => {
      if (!flag.name || flag.name !== name) {
        errors.push(`Feature flag name mismatch: ${name}`);
      }

      if (!flag.description || flag.description.trim().length === 0) {
        errors.push(`Feature flag ${name} missing description`);
      }

      if (flag.planRestrictions && flag.planRestrictions.length === 0) {
        errors.push(`Feature flag ${name} has empty plan restrictions`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Resets feature flags to default values
   */
  resetToDefaults(): void {
    this.featureFlags.clear();
    this.initializeFeatureFlags();
  }
}
