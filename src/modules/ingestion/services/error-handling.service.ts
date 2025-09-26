import { Injectable, Logger } from '@nestjs/common';

export enum ErrorCategory {
  FILE_ERROR = 'FILE_ERROR',
  MAPPING_ERROR = 'MAPPING_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  QUEUE_ERROR = 'QUEUE_ERROR'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ProcessingError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  details?: any;
  rowNumber?: number;
  field?: string;
  suggestedFix?: string;
  retryable: boolean;
  timestamp: Date;
  uploadId?: number;
  contactId?: number;
}

export interface ErrorSummary {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  retryableErrors: number;
  criticalErrors: number;
  commonErrors: Array<{ message: string; count: number }>;
}

export interface ProcessingStatus {
  uploadId: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  currentStep: string;
  progress: number;
  estimatedTimeRemaining?: number;
  processedRecords: number;
  totalRecords: number;
  errors: ProcessingError[];
  warnings: string[];
  lastUpdated: Date;
}

@Injectable()
export class ErrorHandlingService {
  private readonly logger = new Logger(ErrorHandlingService.name);
  private readonly errors = new Map<string, ProcessingError>();
  private readonly processingStatus = new Map<number, ProcessingStatus>();

  /**
   * Records a processing error
   */
  recordError(error: Omit<ProcessingError, 'id' | 'timestamp'>): ProcessingError {
    const errorId = this.generateErrorId();
    const fullError: ProcessingError = {
      ...error,
      id: errorId,
      timestamp: new Date()
    };

    this.errors.set(errorId, fullError);
    this.logger.error(`Error recorded: ${fullError.message}`, fullError);

    // Update processing status if uploadId is provided
    if (error.uploadId) {
      this.updateProcessingStatus(error.uploadId, { errors: [fullError] });
    }

    return fullError;
  }

  /**
   * Records a file error
   */
  recordFileError(
    uploadId: number,
    message: string,
    details?: any,
    suggestedFix?: string
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.FILE_ERROR,
      severity: ErrorSeverity.HIGH,
      message,
      details,
      suggestedFix,
      retryable: false,
      uploadId
    });
  }

  /**
   * Records a mapping error
   */
  recordMappingError(
    uploadId: number,
    message: string,
    field?: string,
    details?: any,
    suggestedFix?: string
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.MAPPING_ERROR,
      severity: ErrorSeverity.HIGH,
      message,
      field,
      details,
      suggestedFix,
      retryable: false,
      uploadId
    });
  }

  /**
   * Records a validation error
   */
  recordValidationError(
    uploadId: number,
    rowNumber: number,
    message: string,
    field?: string,
    details?: any,
    suggestedFix?: string
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.VALIDATION_ERROR,
      severity: ErrorSeverity.MEDIUM,
      message,
      rowNumber,
      field,
      details,
      suggestedFix,
      retryable: false,
      uploadId
    });
  }

  /**
   * Records a processing error
   */
  recordProcessingError(
    uploadId: number,
    message: string,
    details?: any,
    retryable: boolean = true,
    suggestedFix?: string
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.PROCESSING_ERROR,
      severity: ErrorSeverity.MEDIUM,
      message,
      details,
      suggestedFix,
      retryable,
      uploadId
    });
  }

  /**
   * Records an external API error
   */
  recordExternalApiError(
    uploadId: number,
    apiName: string,
    message: string,
    details?: any,
    retryable: boolean = true
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.EXTERNAL_API_ERROR,
      severity: ErrorSeverity.MEDIUM,
      message: `${apiName}: ${message}`,
      details,
      retryable,
      uploadId
    });
  }

  /**
   * Records a database error
   */
  recordDatabaseError(
    uploadId: number,
    message: string,
    details?: any,
    retryable: boolean = true
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.DATABASE_ERROR,
      severity: ErrorSeverity.HIGH,
      message,
      details,
      retryable,
      uploadId
    });
  }

  /**
   * Records a queue error
   */
  recordQueueError(
    uploadId: number,
    message: string,
    details?: any,
    retryable: boolean = true
  ): ProcessingError {
    return this.recordError({
      category: ErrorCategory.QUEUE_ERROR,
      severity: ErrorSeverity.HIGH,
      message,
      details,
      retryable,
      uploadId
    });
  }

  /**
   * Updates processing status
   */
  updateProcessingStatus(
    uploadId: number,
    updates: Partial<ProcessingStatus>
  ): ProcessingStatus {
    const currentStatus = this.processingStatus.get(uploadId) || {
      uploadId,
      status: 'pending',
      currentStep: 'Initializing',
      progress: 0,
      processedRecords: 0,
      totalRecords: 0,
      errors: [],
      warnings: [],
      lastUpdated: new Date()
    };

    const updatedStatus: ProcessingStatus = {
      ...currentStatus,
      ...updates,
      lastUpdated: new Date()
    };

    this.processingStatus.set(uploadId, updatedStatus);
    return updatedStatus;
  }

  /**
   * Gets processing status for an upload
   */
  getProcessingStatus(uploadId: number): ProcessingStatus | null {
    return this.processingStatus.get(uploadId) || null;
  }

  /**
   * Gets all errors for an upload
   */
  getErrorsForUpload(uploadId: number): ProcessingError[] {
    return Array.from(this.errors.values())
      .filter(error => error.uploadId === uploadId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Gets error summary for an upload
   */
  getErrorSummary(uploadId: number): ErrorSummary {
    const errors = this.getErrorsForUpload(uploadId);
    
    const errorsByCategory = Object.values(ErrorCategory).reduce((acc, category) => {
      acc[category] = errors.filter(e => e.category === category).length;
      return acc;
    }, {} as Record<ErrorCategory, number>);

    const errorsBySeverity = Object.values(ErrorSeverity).reduce((acc, severity) => {
      acc[severity] = errors.filter(e => e.severity === severity).length;
      return acc;
    }, {} as Record<ErrorSeverity, number>);

    const retryableErrors = errors.filter(e => e.retryable).length;
    const criticalErrors = errors.filter(e => e.severity === ErrorSeverity.CRITICAL).length;

    // Find common errors
    const errorCounts = new Map<string, number>();
    errors.forEach(error => {
      const count = errorCounts.get(error.message) || 0;
      errorCounts.set(error.message, count + 1);
    });

    const commonErrors = Array.from(errorCounts.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalErrors: errors.length,
      errorsByCategory,
      errorsBySeverity,
      retryableErrors,
      criticalErrors,
      commonErrors
    };
  }

  /**
   * Gets suggested fixes for common errors
   */
  getSuggestedFixes(uploadId: number): Array<{ error: string; fix: string }> {
    const errors = this.getErrorsForUpload(uploadId);
    const suggestions: Array<{ error: string; fix: string }> = [];

    errors.forEach(error => {
      if (error.suggestedFix) {
        suggestions.push({
          error: error.message,
          fix: error.suggestedFix
        });
      }
    });

    return suggestions;
  }

  /**
   * Clears errors for an upload
   */
  clearErrorsForUpload(uploadId: number): void {
    const errorsToDelete = Array.from(this.errors.entries())
      .filter(([_, error]) => error.uploadId === uploadId)
      .map(([id, _]) => id);

    errorsToDelete.forEach(id => this.errors.delete(id));
  }

  /**
   * Gets retryable errors for an upload
   */
  getRetryableErrors(uploadId: number): ProcessingError[] {
    return this.getErrorsForUpload(uploadId)
      .filter(error => error.retryable);
  }

  /**
   * Generates a unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets error statistics
   */
  getErrorStatistics(): {
    totalErrors: number;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    activeUploads: number;
  } {
    const allErrors = Array.from(this.errors.values());
    
    const errorsByCategory = Object.values(ErrorCategory).reduce((acc, category) => {
      acc[category] = allErrors.filter(e => e.category === category).length;
      return acc;
    }, {} as Record<ErrorCategory, number>);

    const errorsBySeverity = Object.values(ErrorSeverity).reduce((acc, severity) => {
      acc[severity] = allErrors.filter(e => e.severity === severity).length;
      return acc;
    }, {} as Record<ErrorSeverity, number>);

    const activeUploads = this.processingStatus.size;

    return {
      totalErrors: allErrors.length,
      errorsByCategory,
      errorsBySeverity,
      activeUploads
    };
  }

  /**
   * Validates CSV file and returns errors
   */
  validateCsvFile(file: Express.Multer.File): ProcessingError[] {
    const errors: ProcessingError[] = [];

    // Check file existence
    if (!file) {
      errors.push({
        id: this.generateErrorId(),
        category: ErrorCategory.FILE_ERROR,
        severity: ErrorSeverity.CRITICAL,
        message: 'No file provided',
        suggestedFix: 'Please select a CSV file to upload',
        retryable: false,
        timestamp: new Date()
      });
      return errors;
    }

    // Check file extension
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      errors.push({
        id: this.generateErrorId(),
        category: ErrorCategory.FILE_ERROR,
        severity: ErrorSeverity.HIGH,
        message: 'File must be a CSV file',
        suggestedFix: 'Please upload a file with .csv extension',
        retryable: false,
        timestamp: new Date()
      });
    }

    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      errors.push({
        id: this.generateErrorId(),
        category: ErrorCategory.FILE_ERROR,
        severity: ErrorSeverity.HIGH,
        message: `File size exceeds limit (${Math.round(file.size / 1024 / 1024)}MB > 10MB)`,
        suggestedFix: 'Please reduce file size to under 10MB',
        retryable: false,
        timestamp: new Date()
      });
    }

    // Check if file is too small
    if (file.size < 100) {
      errors.push({
        id: this.generateErrorId(),
        category: ErrorCategory.FILE_ERROR,
        severity: ErrorSeverity.MEDIUM,
        message: 'File is very small, may not contain valid CSV data',
        suggestedFix: 'Please check if the file contains valid CSV data',
        retryable: false,
        timestamp: new Date()
      });
    }

    return errors;
  }

  /**
   * Validates column mapping and returns errors
   */
  validateColumnMapping(mapping: any): ProcessingError[] {
    const errors: ProcessingError[] = [];

    // Check if mapping exists
    if (!mapping || typeof mapping !== 'object') {
      errors.push({
        id: this.generateErrorId(),
        category: ErrorCategory.MAPPING_ERROR,
        severity: ErrorSeverity.HIGH,
        message: 'Column mapping is required',
        suggestedFix: 'Please provide a valid column mapping',
        retryable: false,
        timestamp: new Date()
      });
      return errors;
    }

    // Check required fields
    const requiredFields = ['businessName', 'email', 'website'];
    const mappedFields: string[] = Object.values(mapping).filter((field): field is string => 
      typeof field === 'string' && field.trim() !== ''
    );
    const hasRequiredField = requiredFields.some(field => 
      mappedFields.includes(field)
    );

    if (!hasRequiredField) {
      errors.push({
        id: this.generateErrorId(),
        category: ErrorCategory.MAPPING_ERROR,
        severity: ErrorSeverity.HIGH,
        message: 'At least one of businessName, email, or website must be mapped',
        suggestedFix: 'Please map at least one of the required fields: businessName, email, or website',
        retryable: false,
        timestamp: new Date()
      });
    }

    // Check for duplicate mappings
    const fieldCounts: Record<string, number> = mappedFields.reduce((acc: Record<string, number>, field: string) => {
      acc[field] = (acc[field] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(fieldCounts).forEach(([field, count]) => {
      if (count > 1) {
        errors.push({
          id: this.generateErrorId(),
          category: ErrorCategory.MAPPING_ERROR,
          severity: ErrorSeverity.MEDIUM,
          message: `Field "${field}" is mapped to multiple columns`,
          suggestedFix: 'Please ensure each field is mapped to only one column',
          retryable: false,
          timestamp: new Date()
        });
      }
    });

    return errors;
  }
}
