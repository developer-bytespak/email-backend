import { Injectable, Logger } from '@nestjs/common';
import { ErrorHandlingService, ProcessingError, ProcessingStatus, ErrorCategory } from './error-handling.service';

export interface UserFeedback {
  uploadId: number;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: any;
  suggestions?: string[];
  timestamp: Date;
}

export interface ProcessingReport {
  uploadId: number;
  fileName: string;
  status: 'completed' | 'failed' | 'partial';
  summary: {
    totalRecords: number;
    successfulRecords: number;
    invalidRecords: number;
    duplicateRecords: number;
    processingTime: number;
    dataQualityScore: number;
  };
  errors: ProcessingError[];
  warnings: string[];
  suggestions: string[];
  generatedAt: Date;
}

export interface RealTimeUpdate {
  uploadId: number;
  step: string;
  progress: number;
  message: string;
  estimatedTimeRemaining?: number;
  timestamp: Date;
}

@Injectable()
export class UserFeedbackService {
  private readonly logger = new Logger(UserFeedbackService.name);
  private readonly feedbackHistory = new Map<number, UserFeedback[]>();
  private readonly processingReports = new Map<number, ProcessingReport>();

  constructor(private readonly errorHandlingService: ErrorHandlingService) {}

  /**
   * Generates user feedback based on processing status
   */
  generateFeedback(uploadId: number, status: ProcessingStatus): UserFeedback {
    let feedback: UserFeedback;

    switch (status.status) {
      case 'completed':
        feedback = this.generateSuccessFeedback(uploadId, status);
        break;
      case 'failed':
        feedback = this.generateErrorFeedback(uploadId, status);
        break;
      case 'processing':
        feedback = this.generateProcessingFeedback(uploadId, status);
        break;
      default:
        feedback = this.generatePendingFeedback(uploadId, status);
    }

    this.addFeedbackToHistory(uploadId, feedback);
    return feedback;
  }

  /**
   * Generates success feedback
   */
  private generateSuccessFeedback(uploadId: number, status: ProcessingStatus): UserFeedback {
    const successRate = (status.processedRecords / status.totalRecords) * 100;
    const errorCount = status.errors.length;

    let message: string;
    let feedbackStatus: 'success' | 'warning' | 'error' = 'success';
    const suggestions: string[] = [];

    if (errorCount === 0) {
      message = `✅ Processing completed successfully! All ${status.totalRecords} records were processed without errors.`;
    } else if (successRate >= 90) {
      message = `✅ Processing completed with minor issues. ${status.processedRecords}/${status.totalRecords} records processed successfully (${successRate.toFixed(1)}% success rate).`;
      feedbackStatus = 'warning';
      suggestions.push('Review the error details below to improve data quality for future uploads.');
    } else {
      message = `⚠️ Processing completed with significant issues. Only ${status.processedRecords}/${status.totalRecords} records processed successfully (${successRate.toFixed(1)}% success rate).`;
      feedbackStatus = 'warning';
      suggestions.push('Please review and fix the data issues before reprocessing.');
      suggestions.push('Consider using the suggested fixes below to improve data quality.');
    }

    return {
      uploadId,
      status: feedbackStatus,
      message,
      suggestions,
      timestamp: new Date()
    };
  }

  /**
   * Generates error feedback
   */
  private generateErrorFeedback(uploadId: number, status: ProcessingStatus): UserFeedback {
    const criticalErrors = status.errors.filter(e => e.severity === 'CRITICAL').length;
    const retryableErrors = status.errors.filter(e => e.retryable).length;

    let message: string;
    const suggestions: string[] = [];

    if (criticalErrors > 0) {
      message = `❌ Processing failed due to critical errors. ${criticalErrors} critical error(s) prevented processing.`;
      suggestions.push('Please fix the critical errors and try again.');
    } else if (retryableErrors > 0) {
      message = `❌ Processing failed due to temporary issues. ${retryableErrors} error(s) may be retryable.`;
      suggestions.push('Try reprocessing the file - some errors may resolve automatically.');
    } else {
      message = `❌ Processing failed. Please review the errors below and try again.`;
      suggestions.push('Check the error details and fix the issues before reprocessing.');
    }

    // Add specific suggestions based on error types
    const errorCategories = new Set(status.errors.map(e => e.category));
    if (errorCategories.has(ErrorCategory.FILE_ERROR)) {
      suggestions.push('Ensure your CSV file is properly formatted and under 10MB.');
    }
    if (errorCategories.has(ErrorCategory.MAPPING_ERROR)) {
      suggestions.push('Review your column mapping - ensure required fields are mapped correctly.');
    }
    if (errorCategories.has(ErrorCategory.VALIDATION_ERROR)) {
      suggestions.push('Check your data for missing or invalid values in required fields.');
    }

    return {
      uploadId,
      status: 'error',
      message,
      suggestions,
      timestamp: new Date()
    };
  }

  /**
   * Generates processing feedback
   */
  private generateProcessingFeedback(uploadId: number, status: ProcessingStatus): UserFeedback {
    const progress = status.progress;
    const processedRecords = status.processedRecords;
    const totalRecords = status.totalRecords;

    let message: string;
    const suggestions: string[] = [];

    if (progress < 25) {
      message = `🔄 Processing started... ${processedRecords}/${totalRecords} records processed (${progress}% complete).`;
    } else if (progress < 50) {
      message = `🔄 Processing in progress... ${processedRecords}/${totalRecords} records processed (${progress}% complete).`;
    } else if (progress < 75) {
      message = `🔄 Processing continues... ${processedRecords}/${totalRecords} records processed (${progress}% complete).`;
    } else {
      message = `🔄 Almost done... ${processedRecords}/${totalRecords} records processed (${progress}% complete).`;
    }

    if (status.errors.length > 0) {
      suggestions.push(`${status.errors.length} error(s) encountered so far - processing will continue.`);
    }

    if (status.estimatedTimeRemaining) {
      const minutes = Math.ceil(status.estimatedTimeRemaining / 60);
      suggestions.push(`Estimated time remaining: ${minutes} minute(s).`);
    }

    return {
      uploadId,
      status: 'warning',
      message,
      suggestions,
      timestamp: new Date()
    };
  }

  /**
   * Generates pending feedback
   */
  private generatePendingFeedback(uploadId: number, status: ProcessingStatus): UserFeedback {
    return {
      uploadId,
      status: 'warning',
      message: `⏳ Processing is pending. Current step: ${status.currentStep}`,
      suggestions: ['Please wait while the system prepares your file for processing.'],
      timestamp: new Date()
    };
  }

  /**
   * Generates a comprehensive processing report
   */
  generateProcessingReport(
    uploadId: number,
    fileName: string,
    status: ProcessingStatus
  ): ProcessingReport {
    const errors = status.errors;
    const totalRecords = status.totalRecords;
    const successfulRecords = status.processedRecords - errors.length;
    const invalidRecords = errors.filter(e => e.category === ErrorCategory.VALIDATION_ERROR).length;
    const duplicateRecords = errors.filter(e => e.category === ErrorCategory.VALIDATION_ERROR && e.message.includes('duplicate')).length;

    // Calculate data quality score
    const dataQualityScore = totalRecords > 0 ? (successfulRecords / totalRecords) : 0;

    // Determine overall status
    let reportStatus: 'completed' | 'failed' | 'partial';
    if (status.status === 'failed') {
      reportStatus = 'failed';
    } else if (dataQualityScore >= 0.9) {
      reportStatus = 'completed';
    } else {
      reportStatus = 'partial';
    }

    // Generate warnings
    const warnings: string[] = [];
    if (invalidRecords > 0) {
      warnings.push(`${invalidRecords} records have validation errors`);
    }
    if (duplicateRecords > 0) {
      warnings.push(`${duplicateRecords} duplicate records found`);
    }
    if (dataQualityScore < 0.8) {
      warnings.push(`Data quality score is low (${(dataQualityScore * 100).toFixed(1)}%)`);
    }

    // Generate suggestions
    const suggestions: string[] = [];
    const errorSummary = this.errorHandlingService.getErrorSummary(uploadId);
    
    if (errorSummary.commonErrors.length > 0) {
      suggestions.push(`Most common error: ${errorSummary.commonErrors[0].message} (${errorSummary.commonErrors[0].count} occurrences)`);
    }

    if (errorSummary.retryableErrors > 0) {
      suggestions.push(`${errorSummary.retryableErrors} errors may be resolved by retrying`);
    }

    if (dataQualityScore < 0.7) {
      suggestions.push('Consider reviewing your data source for better quality');
      suggestions.push('Ensure all required fields are properly filled');
    }

    const report: ProcessingReport = {
      uploadId,
      fileName,
      status: reportStatus,
      summary: {
        totalRecords,
        successfulRecords,
        invalidRecords,
        duplicateRecords,
        processingTime: status.lastUpdated.getTime() - status.lastUpdated.getTime(), // This would be calculated properly
        dataQualityScore
      },
      errors,
      warnings,
      suggestions,
      generatedAt: new Date()
    };

    this.processingReports.set(uploadId, report);
    return report;
  }

  /**
   * Generates real-time updates
   */
  generateRealTimeUpdate(
    uploadId: number,
    step: string,
    progress: number,
    message: string,
    estimatedTimeRemaining?: number
  ): RealTimeUpdate {
    const update: RealTimeUpdate = {
      uploadId,
      step,
      progress,
      message,
      estimatedTimeRemaining,
      timestamp: new Date()
    };

    this.logger.debug(`Real-time update for upload ${uploadId}: ${message}`);
    return update;
  }

  /**
   * Gets feedback history for an upload
   */
  getFeedbackHistory(uploadId: number): UserFeedback[] {
    return this.feedbackHistory.get(uploadId) || [];
  }

  /**
   * Gets processing report for an upload
   */
  getProcessingReport(uploadId: number): ProcessingReport | null {
    return this.processingReports.get(uploadId) || null;
  }

  /**
   * Generates suggested fixes for common issues
   */
  generateSuggestedFixes(uploadId: number): Array<{ issue: string; fix: string; priority: 'high' | 'medium' | 'low' }> {
    const errors = this.errorHandlingService.getErrorsForUpload(uploadId);
    const suggestions: Array<{ issue: string; fix: string; priority: 'high' | 'medium' | 'low' }> = [];

    // Group errors by type and generate suggestions
    const errorGroups = new Map<string, ProcessingError[]>();
    errors.forEach(error => {
      const key = `${error.category}_${error.message}`;
      if (!errorGroups.has(key)) {
        errorGroups.set(key, []);
      }
      errorGroups.get(key)!.push(error);
    });

    errorGroups.forEach((errorList, key) => {
      const error = errorList[0];
      const count = errorList.length;
      
      let priority: 'high' | 'medium' | 'low' = 'medium';
      if (error.severity === 'CRITICAL' || error.severity === 'HIGH') {
        priority = 'high';
      } else if (error.severity === 'LOW') {
        priority = 'low';
      }

      suggestions.push({
        issue: `${error.message} (${count} occurrence${count > 1 ? 's' : ''})`,
        fix: error.suggestedFix || this.getDefaultFix(error.category),
        priority
      });
    });

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Gets default fix for error category
   */
  private getDefaultFix(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.FILE_ERROR:
        return 'Check file format and size, ensure it\'s a valid CSV file under 10MB';
      case ErrorCategory.MAPPING_ERROR:
        return 'Review column mapping and ensure required fields are mapped correctly';
      case ErrorCategory.VALIDATION_ERROR:
        return 'Check data quality and ensure all required fields have valid values';
      case ErrorCategory.PROCESSING_ERROR:
        return 'Try reprocessing the file or contact support if the issue persists';
      case ErrorCategory.EXTERNAL_API_ERROR:
        return 'External service temporarily unavailable, try again later';
      case ErrorCategory.DATABASE_ERROR:
        return 'Database connection issue, try again or contact support';
      case ErrorCategory.QUEUE_ERROR:
        return 'Processing queue issue, try again or contact support';
      default:
        return 'Please review the error details and try again';
    }
  }

  /**
   * Adds feedback to history
   */
  private addFeedbackToHistory(uploadId: number, feedback: UserFeedback): void {
    if (!this.feedbackHistory.has(uploadId)) {
      this.feedbackHistory.set(uploadId, []);
    }
    this.feedbackHistory.get(uploadId)!.push(feedback);
  }

  /**
   * Clears feedback history for an upload
   */
  clearFeedbackHistory(uploadId: number): void {
    this.feedbackHistory.delete(uploadId);
    this.processingReports.delete(uploadId);
  }

  /**
   * Gets feedback statistics
   */
  getFeedbackStatistics(): {
    totalUploads: number;
    successfulUploads: number;
    failedUploads: number;
    averageDataQuality: number;
  } {
    const reports = Array.from(this.processingReports.values());
    
    const totalUploads = reports.length;
    const successfulUploads = reports.filter(r => r.status === 'completed').length;
    const failedUploads = reports.filter(r => r.status === 'failed').length;
    const averageDataQuality = reports.length > 0 
      ? reports.reduce((sum, r) => sum + r.summary.dataQualityScore, 0) / reports.length
      : 0;

    return {
      totalUploads,
      successfulUploads,
      failedUploads,
      averageDataQuality
    };
  }
}
