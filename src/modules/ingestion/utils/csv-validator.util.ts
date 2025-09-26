export interface CsvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  headers?: string[];
  rowCount?: number;
}

export class CsvValidatorUtil {
  /**
   * Validates CSV content format and structure
   */
  static validateCsvContent(content: string): CsvValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || content.trim().length === 0) {
      errors.push('CSV content is empty');
      return { isValid: false, errors, warnings };
    }

    const lines = content.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
      errors.push('No data rows found in CSV');
      return { isValid: false, errors, warnings };
    }

    // Check headers
    const headers = this.parseCsvLine(lines[0]);
    if (headers.length === 0) {
      errors.push('No headers found in CSV');
      return { isValid: false, errors, warnings };
    }

    // Check for duplicate headers
    const duplicateHeaders = this.findDuplicateHeaders(headers);
    if (duplicateHeaders.length > 0) {
      errors.push(`Duplicate headers found: ${duplicateHeaders.join(', ')}`);
    }

    // Check data rows
    const dataRows = lines.slice(1);
    if (dataRows.length === 0) {
      warnings.push('No data rows found');
    }

    // Validate each data row
    for (let i = 0; i < dataRows.length; i++) {
      const row = this.parseCsvLine(dataRows[i]);
      if (row.length !== headers.length) {
        errors.push(`Row ${i + 2}: Column count mismatch (expected ${headers.length}, got ${row.length})`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      headers,
      rowCount: dataRows.length
    };
  }

  /**
   * Validates CSV file size and format
   */
  static validateCsvFile(file: Express.Multer.File): CsvValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!file) {
      errors.push('No file provided');
      return { isValid: false, errors, warnings };
    }

    // Check file extension
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      errors.push('File must be a CSV file');
    }

    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      errors.push(`File size exceeds limit (${Math.round(file.size / 1024 / 1024)}MB > 10MB)`);
    }

    // Check if file is too small
    if (file.size < 100) { // Less than 100 bytes
      warnings.push('File is very small, may not contain valid CSV data');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Parses a CSV line handling quoted fields
   */
  private static parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }

    // Add the last field
    result.push(current.trim());

    return result;
  }

  /**
   * Finds duplicate headers in CSV
   */
  private static findDuplicateHeaders(headers: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    headers.forEach(header => {
      const normalized = header.toLowerCase().trim();
      if (seen.has(normalized)) {
        duplicates.add(header);
      } else {
        seen.add(normalized);
      }
    });

    return Array.from(duplicates);
  }

  /**
   * Detects CSV encoding issues
   */
  static detectEncodingIssues(content: string): string[] {
    const issues: string[] = [];

    // Check for common encoding problems
    if (content.includes('�')) {
      issues.push('File may have encoding issues (replacement characters detected)');
    }

    // Check for mixed line endings
    const hasWindowsEndings = content.includes('\r\n');
    const hasUnixEndings = content.includes('\n') && !hasWindowsEndings;
    const hasMacEndings = content.includes('\r') && !hasWindowsEndings;

    if ((hasWindowsEndings && hasUnixEndings) || (hasWindowsEndings && hasMacEndings)) {
      issues.push('Mixed line endings detected');
    }

    return issues;
  }

  /**
   * Estimates processing time based on CSV size
   */
  static estimateProcessingTime(rowCount: number, planType: 'promotional' | 'personal'): number {
    // Base processing time per record (in seconds)
    const baseTimePerRecord = planType === 'promotional' ? 0.1 : 0.5;
    
    // Add overhead for external API calls (Personal plan only)
    const apiOverhead = planType === 'personal' ? 0.3 : 0;
    
    const totalTime = rowCount * (baseTimePerRecord + apiOverhead);
    
    // Add base processing overhead
    return Math.max(5, totalTime + 10); // Minimum 5 seconds, plus 10 seconds overhead
  }
}
