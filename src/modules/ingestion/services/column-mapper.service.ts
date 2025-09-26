import { Injectable } from '@nestjs/common';
import { ColumnMappingDto } from '../dto/column-mapping.dto';

export interface CsvRow {
  [key: string]: string;
}

export interface MappedRow {
  businessName?: string;
  email?: string;
  website?: string;
  phone?: string;
  stateProvince?: string;
  zip?: string;
  country?: string;
}

@Injectable()
export class ColumnMapperService {
  /**
   * Maps CSV row data to standardized contact fields based on column mapping
   */
  mapRowToContact(row: CsvRow, mapping: ColumnMappingDto): MappedRow {
    const mappedRow: MappedRow = {};

    // Map each field if the mapping exists
    if (mapping.businessName && row[mapping.businessName]) {
      mappedRow.businessName = this.normalizeBusinessName(
        row[mapping.businessName],
      );
    }

    if (mapping.email && row[mapping.email]) {
      mappedRow.email = this.normalizeEmail(row[mapping.email]);
    }

    if (mapping.website && row[mapping.website]) {
      mappedRow.website = this.normalizeWebsite(row[mapping.website]);
    }

    if (mapping.phone && row[mapping.phone]) {
      mappedRow.phone = this.normalizePhone(row[mapping.phone]);
    }

    if (mapping.stateProvince && row[mapping.stateProvince]) {
      mappedRow.stateProvince = this.normalizeStateProvince(
        row[mapping.stateProvince],
      );
    }

    if (mapping.zip && row[mapping.zip]) {
      mappedRow.zip = this.normalizeZip(row[mapping.zip]);
    }

    if (mapping.country && row[mapping.country]) {
      mappedRow.country = this.normalizeCountry(row[mapping.country]);
    }

    return mappedRow;
  }

  /**
   * Validates that required fields are mapped
   */
  validateMapping(mapping: ColumnMappingDto): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const mappedFields = Object.values(mapping).filter(
      (field) => field && field.trim() !== '',
    );

    // Check if at least one of the three required fields is mapped
    const hasRequiredField = mappedFields.some((field) =>
      ['businessName', 'email', 'website'].includes(field),
    );

    if (!hasRequiredField) {
      errors.push(
        'At least one of businessName, email, or website must be mapped',
      );
    }

    // Check for duplicate mappings
    const fieldCounts = mappedFields.reduce(
      (acc, field) => {
        acc[field] = (acc[field] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    Object.entries(fieldCounts).forEach(([field, count]) => {
      if ((count as number) > 1) {
        errors.push(`Field "${field}" is mapped to multiple columns`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Suggests column mappings based on CSV headers
   */
  suggestMapping(headers: string[]): Partial<ColumnMappingDto> {
    const suggestions: Partial<ColumnMappingDto> = {};

    const fieldPatterns = {
      businessName: ['business', 'company', 'name', 'organization', 'firm'],
      email: ['email', 'e-mail', 'mail', 'contact'],
      website: ['website', 'web', 'url', 'site', 'domain'],
      phone: ['phone', 'telephone', 'mobile', 'cell', 'contact'],
      stateProvince: ['state', 'province', 'region', 'area'],
      zip: ['zip', 'postal', 'code', 'postcode'],
      country: ['country', 'nation', 'location'],
    };

    headers.forEach((header) => {
      const normalizedHeader = header.toLowerCase().trim();

      Object.entries(fieldPatterns).forEach(([field, patterns]) => {
        if (patterns.some((pattern) => normalizedHeader.includes(pattern))) {
          suggestions[field as keyof ColumnMappingDto] = header;
        }
      });
    });

    return suggestions;
  }

  private normalizeBusinessName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeWebsite(website: string): string {
    let normalized = website.trim().toLowerCase();

    // Add protocol if missing
    if (
      !normalized.startsWith('http://') &&
      !normalized.startsWith('https://')
    ) {
      normalized = 'https://' + normalized;
    }

    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  private normalizePhone(phone: string): string {
    // Remove all non-digit characters except + at the beginning
    return phone.replace(/[^\d+]/g, '').trim();
  }

  private normalizeStateProvince(state: string): string {
    return state.trim().replace(/\s+/g, ' ');
  }

  private normalizeZip(zip: string): string {
    return zip.trim().replace(/\s+/g, '');
  }

  private normalizeCountry(country: string): string {
    return country.trim().replace(/\s+/g, ' ');
  }
}
