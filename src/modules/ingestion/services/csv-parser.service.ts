import { Injectable } from '@nestjs/common';
import { ColumnMappingDto } from '../dto/column-mapping.dto';

export interface ParsedRow {
  businessName: string;
  email?: string;
  phone?: string;
  website?: string;
  stateProvince?: string;
  zip?: string;
  country?: string;
}

@Injectable()
export class CsvParserService {
  parseCsvData(csvContent: string, mapping: ColumnMappingDto): ParsedRow[] {
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header and one data row');
    }

    const headers = this.parseCsvLine(lines[0]);
    const dataRows = lines.slice(1);

    // Create column index mapping
    const columnIndexes = this.createColumnIndexes(headers, mapping);

    const parsedRows: ParsedRow[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = this.parseCsvLine(dataRows[i]);
      
      try {
        const parsedRow = this.mapRowToFields(row, columnIndexes);
        parsedRows.push(parsedRow);
      } catch (error) {
        console.warn(`Skipping row ${i + 2}: ${error.message}`);
        continue;
      }
    }

    return parsedRows;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  private createColumnIndexes(headers: string[], mapping: ColumnMappingDto): Record<string, number> {
    const indexes: Record<string, number> = {};
    
    // Map each field to its column index
    Object.entries(mapping).forEach(([field, columnName]) => {
      const index = headers.findIndex(header => 
        header.toLowerCase().trim() === columnName.toLowerCase().trim()
      );
      
      if (index !== -1) {
        indexes[field] = index;
      }
    });

    return indexes;
  }

  private mapRowToFields(row: string[], columnIndexes: Record<string, number>): ParsedRow {
    const parsedRow: ParsedRow = {
      businessName: '',
    };

    // Extract values based on column indexes
    Object.entries(columnIndexes).forEach(([field, index]) => {
      const value = row[index]?.trim() || '';
      
      switch (field) {
        case 'businessName':
          parsedRow.businessName = value;
          break;
        case 'email':
          parsedRow.email = value || undefined;
          break;
        case 'phone':
          parsedRow.phone = value || undefined;
          break;
        case 'website':
          parsedRow.website = value || undefined;
          break;
        case 'stateProvince':
          parsedRow.stateProvince = value || undefined;
          break;
        case 'zip':
          parsedRow.zip = value || undefined;
          break;
        case 'country':
          parsedRow.country = value || undefined;
          break;
      }
    });

    // Validate required fields
    if (!parsedRow.businessName) {
      throw new Error('Business name is required');
    }

    return parsedRow;
  }

  validateCsvFormat(csvContent: string): { isValid: boolean; error?: string } {
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return {
        isValid: false,
        error: 'CSV file must have at least a header and one data row',
      };
    }

    const headers = this.parseCsvLine(lines[0]);
    if (headers.length === 0) {
      return {
        isValid: false,
        error: 'CSV file must have headers',
      };
    }

    // Check if all rows have the same number of columns
    for (let i = 1; i < lines.length; i++) {
      const row = this.parseCsvLine(lines[i]);
      if (row.length !== headers.length) {
        return {
          isValid: false,
          error: `Row ${i + 1} has ${row.length} columns, expected ${headers.length}`,
        };
      }
    }

    return { isValid: true };
  }
}
