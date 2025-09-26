import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue, Job } from 'bull';
import { PrismaService } from '../../../common/services/prisma.service';

export interface CsvProcessingJobData {
  uploadId: number;
  clientId: number;
  planName: string;
  csvContent: string;
  columnMapping: any;
}

export interface ProcessingProgress {
  uploadId: number;
  totalRecords: number;
  processedRecords: number;
  successfulRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  currentStep: string;
  progress: number;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('csv-processing') private csvProcessingQueue: Queue,
    @InjectQueue('email-validation') private emailValidationQueue: Queue,
    @InjectQueue('website-resolution') private websiteResolutionQueue: Queue,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Adds CSV processing job to queue
   */
  async addCsvProcessingJob(data: CsvProcessingJobData): Promise<Job<CsvProcessingJobData>> {
    try {
      const job = await this.csvProcessingQueue.add('process-csv', data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      this.logger.log(`CSV processing job added: ${job.id} for upload ${data.uploadId}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add CSV processing job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Adds email validation job to queue
   */
  async addEmailValidationJob(email: string, contactId: number): Promise<Job> {
    try {
      const job = await this.emailValidationQueue.add('validate-email', {
        email,
        contactId
      }, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 50,
        removeOnFail: 10,
      });

      return job;
    } catch (error) {
      this.logger.error(`Failed to add email validation job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Adds website resolution job to queue
   */
  async addWebsiteResolutionJob(
    businessName: string,
    email: string,
    contactId: number
  ): Promise<Job> {
    try {
      const job = await this.websiteResolutionQueue.add('resolve-website', {
        businessName,
        email,
        contactId
      }, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 50,
        removeOnFail: 10,
      });

      return job;
    } catch (error) {
      this.logger.error(`Failed to add website resolution job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets job status
   */
  async getJobStatus(jobId: string, queueName: string): Promise<any> {
    try {
      let queue: Queue;
      
      switch (queueName) {
        case 'csv-processing':
          queue = this.csvProcessingQueue;
          break;
        case 'email-validation':
          queue = this.emailValidationQueue;
          break;
        case 'website-resolution':
          queue = this.websiteResolutionQueue;
          break;
        default:
          throw new Error(`Unknown queue: ${queueName}`);
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        return null;
      }

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress(),
        state: await job.getState(),
        createdAt: new Date(job.timestamp),
        processedOn: job.processedOn ? new Date(job.processedOn) : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn) : null,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        opts: job.opts
      };
    } catch (error) {
      this.logger.error(`Failed to get job status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets queue statistics
   */
  async getQueueStats(): Promise<any> {
    try {
      const [csvStats, emailStats, websiteStats] = await Promise.all([
        this.csvProcessingQueue.getJobCounts(),
        this.emailValidationQueue.getJobCounts(),
        this.websiteResolutionQueue.getJobCounts()
      ]);

      return {
        csvProcessing: csvStats,
        emailValidation: emailStats,
        websiteResolution: websiteStats,
        totalJobs: {
          waiting: csvStats.waiting + emailStats.waiting + websiteStats.waiting,
          active: csvStats.active + emailStats.active + websiteStats.active,
          completed: csvStats.completed + emailStats.completed + websiteStats.completed,
          failed: csvStats.failed + emailStats.failed + websiteStats.failed
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get queue stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clears completed jobs from all queues
   */
  async clearCompletedJobs(): Promise<void> {
    try {
      await Promise.all([
        this.csvProcessingQueue.clean(0, 'completed'),
        this.emailValidationQueue.clean(0, 'completed'),
        this.websiteResolutionQueue.clean(0, 'completed')
      ]);

      this.logger.log('Completed jobs cleared from all queues');
    } catch (error) {
      this.logger.error(`Failed to clear completed jobs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clears failed jobs from all queues
   */
  async clearFailedJobs(): Promise<void> {
    try {
      await Promise.all([
        this.csvProcessingQueue.clean(0, 'failed'),
        this.emailValidationQueue.clean(0, 'failed'),
        this.websiteResolutionQueue.clean(0, 'failed')
      ]);

      this.logger.log('Failed jobs cleared from all queues');
    } catch (error) {
      this.logger.error(`Failed to clear failed jobs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pauses all queues
   */
  async pauseAllQueues(): Promise<void> {
    try {
      await Promise.all([
        this.csvProcessingQueue.pause(),
        this.emailValidationQueue.pause(),
        this.websiteResolutionQueue.pause()
      ]);

      this.logger.log('All queues paused');
    } catch (error) {
      this.logger.error(`Failed to pause queues: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resumes all queues
   */
  async resumeAllQueues(): Promise<void> {
    try {
      await Promise.all([
        this.csvProcessingQueue.resume(),
        this.emailValidationQueue.resume(),
        this.websiteResolutionQueue.resume()
      ]);

      this.logger.log('All queues resumed');
    } catch (error) {
      this.logger.error(`Failed to resume queues: ${error.message}`);
      throw error;
    }
  }

  /**
   * Updates processing progress
   */
  async updateProcessingProgress(progress: ProcessingProgress): Promise<void> {
    try {
      // Update database with progress
      await this.prisma.csvUpload.update({
        where: { id: progress.uploadId },
        data: {
          totalRecords: progress.totalRecords,
          successfulRecords: progress.successfulRecords,
          invalidRecords: progress.invalidRecords,
          duplicateRecords: progress.duplicateRecords
        }
      });

      this.logger.debug(`Progress updated for upload ${progress.uploadId}: ${progress.progress}%`);
    } catch (error) {
      this.logger.error(`Failed to update processing progress: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handles job failure
   */
  async handleJobFailure(job: Job, error: Error): Promise<void> {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
    
    // Update database with failure status
    if (job.data.uploadId) {
      try {
        await this.prisma.csvUpload.update({
          where: { id: job.data.uploadId },
          data: {
            status: 'failure',
            processedAt: new Date()
          }
        });
      } catch (dbError) {
        this.logger.error(`Failed to update database on job failure: ${dbError.message}`);
      }
    }
  }

  /**
   * Gets queue health status
   */
  async getQueueHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    queues: Array<{
      name: string;
      stats: any;
      isPaused: boolean;
      isHealthy: boolean;
    }>;
    issues: string[];
  }> {
    const issues: string[] = [];
    const queues: Array<{
      name: string;
      stats: any;
      isPaused: boolean;
      isHealthy: boolean;
    }> = [];

    try {
      const queueNames = ['csv-processing', 'email-validation', 'website-resolution'];
      
      for (const queueName of queueNames) {
        let queue: Queue;
        switch (queueName) {
          case 'csv-processing':
            queue = this.csvProcessingQueue;
            break;
          case 'email-validation':
            queue = this.emailValidationQueue;
            break;
          case 'website-resolution':
            queue = this.websiteResolutionQueue;
            break;
          default:
            continue; // Skip unknown queue names
        }

        const stats = await queue.getJobCounts();
        const isPaused = await queue.isPaused();
        
        queues.push({
          name: queueName,
          stats,
          isPaused,
          isHealthy: !isPaused && stats.failed < 10
        });

        if (isPaused) {
          issues.push(`${queueName} queue is paused`);
        }

        if (stats.failed > 10) {
          issues.push(`${queueName} queue has ${stats.failed} failed jobs`);
        }
      }

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (issues.length > 0) {
        status = issues.length > 2 ? 'unhealthy' : 'degraded';
      }

      return { status, queues, issues };
    } catch (error) {
      this.logger.error(`Failed to get queue health: ${error.message}`);
      return {
        status: 'unhealthy',
        queues: [],
        issues: [`Failed to check queue health: ${error.message}`]
      };
    }
  }
}
