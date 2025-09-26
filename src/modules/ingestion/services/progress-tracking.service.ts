import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorHandlingService,
  ProcessingStatus,
} from './error-handling.service';
import { UserFeedbackService, RealTimeUpdate } from './user-feedback.service';

export interface ProgressStep {
  id: string;
  name: string;
  description: string;
  weight: number; // Percentage of total progress
  estimatedDuration: number; // In milliseconds
}

export interface ProgressTracker {
  uploadId: number;
  currentStep: string;
  completedSteps: string[];
  progress: number;
  estimatedTimeRemaining: number;
  startTime: Date;
  lastUpdate: Date;
  steps: ProgressStep[];
}

@Injectable()
export class ProgressTrackingService {
  private readonly logger = new Logger(ProgressTrackingService.name);
  private readonly progressTrackers = new Map<number, ProgressTracker>();
  private readonly stepDefinitions: ProgressStep[] = [
    {
      id: 'file_upload',
      name: 'File Upload',
      description: 'Uploading and validating CSV file',
      weight: 5,
      estimatedDuration: 2000,
    },
    {
      id: 'column_mapping',
      name: 'Column Mapping',
      description: 'Mapping CSV columns to system fields',
      weight: 10,
      estimatedDuration: 3000,
    },
    {
      id: 'data_parsing',
      name: 'Data Parsing',
      description: 'Parsing CSV data and validating format',
      weight: 15,
      estimatedDuration: 5000,
    },
    {
      id: 'validation',
      name: 'Data Validation',
      description: 'Validating contact information',
      weight: 25,
      estimatedDuration: 15000,
    },
    {
      id: 'duplicate_detection',
      name: 'Duplicate Detection',
      description: 'Checking for duplicate contacts',
      weight: 15,
      estimatedDuration: 10000,
    },
    {
      id: 'website_resolution',
      name: 'Website Resolution',
      description: 'Resolving websites from business names',
      weight: 20,
      estimatedDuration: 20000,
    },
    {
      id: 'finalization',
      name: 'Finalization',
      description: 'Saving results and generating report',
      weight: 10,
      estimatedDuration: 5000,
    },
  ];

  constructor(
    private readonly errorHandlingService: ErrorHandlingService,
    private readonly userFeedbackService: UserFeedbackService,
  ) {}

  /**
   * Initializes progress tracking for an upload
   */
  initializeProgressTracking(
    uploadId: number,
    totalRecords: number,
  ): ProgressTracker {
    const tracker: ProgressTracker = {
      uploadId,
      currentStep: 'file_upload',
      completedSteps: [],
      progress: 0,
      estimatedTimeRemaining: this.calculateTotalEstimatedTime(),
      startTime: new Date(),
      lastUpdate: new Date(),
      steps: [...this.stepDefinitions],
    };

    this.progressTrackers.set(uploadId, tracker);

    // Initialize processing status
    this.errorHandlingService.updateProcessingStatus(uploadId, {
      status: 'pending',
      currentStep: 'Initializing',
      progress: 0,
      totalRecords,
      processedRecords: 0,
      errors: [],
      warnings: [],
    });

    this.logger.log(`Progress tracking initialized for upload ${uploadId}`);
    return tracker;
  }

  /**
   * Updates progress for a specific step
   */
  updateStepProgress(
    uploadId: number,
    stepId: string,
    stepProgress: number,
    processedRecords: number,
    totalRecords: number,
  ): RealTimeUpdate {
    const tracker = this.progressTrackers.get(uploadId);
    if (!tracker) {
      throw new Error(`Progress tracker not found for upload ${uploadId}`);
    }

    const step = tracker.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found`);
    }

    // Update current step if it's different
    if (tracker.currentStep !== stepId) {
      tracker.currentStep = stepId;
    }

    // Calculate overall progress
    const completedStepsWeight = tracker.completedSteps.reduce(
      (total, completedStepId) => {
        const completedStep = tracker.steps.find(
          (s) => s.id === completedStepId,
        );
        return total + (completedStep?.weight || 0);
      },
      0,
    );

    const currentStepProgress = (stepProgress / 100) * step.weight;
    tracker.progress = Math.min(
      100,
      completedStepsWeight + currentStepProgress,
    );

    // Update estimated time remaining
    tracker.estimatedTimeRemaining =
      this.calculateEstimatedTimeRemaining(tracker);

    // Update processing status
    this.errorHandlingService.updateProcessingStatus(uploadId, {
      status: 'processing',
      currentStep: step.name,
      progress: Math.round(tracker.progress),
      processedRecords,
      totalRecords,
      estimatedTimeRemaining: tracker.estimatedTimeRemaining,
    });

    tracker.lastUpdate = new Date();

    // Generate real-time update
    const update = this.userFeedbackService.generateRealTimeUpdate(
      uploadId,
      step.name,
      Math.round(tracker.progress),
      `${step.description} - ${processedRecords}/${totalRecords} records processed`,
      tracker.estimatedTimeRemaining,
    );

    this.logger.debug(
      `Progress updated for upload ${uploadId}: ${step.name} - ${Math.round(tracker.progress)}%`,
    );
    return update;
  }

  /**
   * Marks a step as completed
   */
  completeStep(uploadId: number, stepId: string): RealTimeUpdate {
    const tracker = this.progressTrackers.get(uploadId);
    if (!tracker) {
      throw new Error(`Progress tracker not found for upload ${uploadId}`);
    }

    const step = tracker.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found`);
    }

    // Add to completed steps if not already there
    if (!tracker.completedSteps.includes(stepId)) {
      tracker.completedSteps.push(stepId);
    }

    // Update progress
    const completedWeight = tracker.completedSteps.reduce(
      (total, completedStepId) => {
        const completedStep = tracker.steps.find(
          (s) => s.id === completedStepId,
        );
        return total + (completedStep?.weight || 0);
      },
      0,
    );

    tracker.progress = Math.min(100, completedWeight);
    tracker.estimatedTimeRemaining =
      this.calculateEstimatedTimeRemaining(tracker);

    // Move to next step
    const nextStep = this.getNextStep(tracker);
    if (nextStep) {
      tracker.currentStep = nextStep.id;
    }

    // Update processing status
    this.errorHandlingService.updateProcessingStatus(uploadId, {
      currentStep: nextStep?.name || 'Completed',
      progress: Math.round(tracker.progress),
    });

    tracker.lastUpdate = new Date();

    // Generate real-time update
    const update = this.userFeedbackService.generateRealTimeUpdate(
      uploadId,
      nextStep?.name || 'Completed',
      Math.round(tracker.progress),
      nextStep ? `Starting ${nextStep.description}` : 'Processing completed',
      tracker.estimatedTimeRemaining,
    );

    this.logger.log(`Step completed for upload ${uploadId}: ${step.name}`);
    return update;
  }

  /**
   * Completes progress tracking
   */
  completeProgressTracking(
    uploadId: number,
    status: 'success' | 'failed',
  ): void {
    const tracker = this.progressTrackers.get(uploadId);
    if (!tracker) {
      this.logger.warn(`Progress tracker not found for upload ${uploadId}`);
      return;
    }

    // Mark all remaining steps as completed
    tracker.steps.forEach((step) => {
      if (!tracker.completedSteps.includes(step.id)) {
        tracker.completedSteps.push(step.id);
      }
    });

    tracker.progress = 100;
    tracker.estimatedTimeRemaining = 0;
    tracker.currentStep = 'completed';

    // Update processing status
    this.errorHandlingService.updateProcessingStatus(uploadId, {
      status: status === 'success' ? 'completed' : 'failed',
      currentStep: 'Completed',
      progress: 100,
    });

    tracker.lastUpdate = new Date();

    this.logger.log(
      `Progress tracking completed for upload ${uploadId}: ${status}`,
    );
  }

  /**
   * Gets current progress for an upload
   */
  getProgress(uploadId: number): ProgressTracker | null {
    return this.progressTrackers.get(uploadId) || null;
  }

  /**
   * Gets processing status for an upload
   */
  getProcessingStatus(uploadId: number): ProcessingStatus | null {
    return this.errorHandlingService.getProcessingStatus(uploadId);
  }

  /**
   * Calculates total estimated time for all steps
   */
  private calculateTotalEstimatedTime(): number {
    return this.stepDefinitions.reduce(
      (total, step) => total + step.estimatedDuration,
      0,
    );
  }

  /**
   * Calculates estimated time remaining based on completed steps
   */
  private calculateEstimatedTimeRemaining(tracker: ProgressTracker): number {
    const remainingSteps = tracker.steps.filter(
      (step) => !tracker.completedSteps.includes(step.id),
    );

    return remainingSteps.reduce(
      (total, step) => total + step.estimatedDuration,
      0,
    );
  }

  /**
   * Gets the next step to be executed
   */
  private getNextStep(tracker: ProgressTracker): ProgressStep | null {
    return (
      tracker.steps.find((step) => !tracker.completedSteps.includes(step.id)) ||
      null
    );
  }

  /**
   * Updates estimated time based on actual processing speed
   */
  updateEstimatedTime(
    uploadId: number,
    actualProcessingTime: number,
    recordsProcessed: number,
  ): void {
    const tracker = this.progressTrackers.get(uploadId);
    if (!tracker) return;

    const timePerRecord = actualProcessingTime / recordsProcessed;
    const remainingRecords = tracker.steps
      .filter((step) => !tracker.completedSteps.includes(step.id))
      .reduce((total, step) => {
        // Estimate records per step based on step weight
        const estimatedRecordsForStep = (step.weight / 100) * recordsProcessed;
        return total + estimatedRecordsForStep;
      }, 0);

    tracker.estimatedTimeRemaining = Math.max(
      0,
      timePerRecord * remainingRecords,
    );
    tracker.lastUpdate = new Date();
  }

  /**
   * Gets progress statistics
   */
  getProgressStatistics(): {
    activeUploads: number;
    averageProgress: number;
    averageTimeRemaining: number;
    completedToday: number;
  } {
    const trackers = Array.from(this.progressTrackers.values());

    const activeUploads = trackers.length;
    const averageProgress =
      trackers.length > 0
        ? trackers.reduce((sum, t) => sum + t.progress, 0) / trackers.length
        : 0;
    const averageTimeRemaining =
      trackers.length > 0
        ? trackers.reduce((sum, t) => sum + t.estimatedTimeRemaining, 0) /
          trackers.length
        : 0;

    // Calculate completed today (this would need to be tracked separately in a real implementation)
    const completedToday = trackers.filter(
      (t) =>
        t.progress === 100 &&
        t.lastUpdate.toDateString() === new Date().toDateString(),
    ).length;

    return {
      activeUploads,
      averageProgress,
      averageTimeRemaining,
      completedToday,
    };
  }

  /**
   * Cleans up completed progress trackers
   */
  cleanupCompletedTrackers(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    for (const [uploadId, tracker] of this.progressTrackers.entries()) {
      if (tracker.progress === 100 && tracker.lastUpdate < cutoffTime) {
        this.progressTrackers.delete(uploadId);
        this.logger.debug(
          `Cleaned up completed tracker for upload ${uploadId}`,
        );
      }
    }
  }

  /**
   * Gets step definitions
   */
  getStepDefinitions(): ProgressStep[] {
    return [...this.stepDefinitions];
  }

  /**
   * Adds custom step for specific processing
   */
  addCustomStep(uploadId: number, step: ProgressStep): void {
    const tracker = this.progressTrackers.get(uploadId);
    if (!tracker) return;

    tracker.steps.push(step);
  }
}
