import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RealTimeUpdate, UserFeedback, ProcessingReport } from './user-feedback.service';
import { ProcessingStatus } from './error-handling.service';

export interface NotificationEvent {
  uploadId: number;
  type: 'progress' | 'error' | 'success' | 'warning';
  message: string;
  data?: any;
  timestamp: Date;
}

export interface WebSocketMessage {
  type: string;
  uploadId: number;
  data: any;
  timestamp: Date;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly activeConnections = new Map<number, Set<string>>(); // uploadId -> connectionIds

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Sends real-time progress update
   */
  sendProgressUpdate(update: RealTimeUpdate): void {
    const notification: NotificationEvent = {
      uploadId: update.uploadId,
      type: 'progress',
      message: update.message,
      data: {
        step: update.step,
        progress: update.progress,
        estimatedTimeRemaining: update.estimatedTimeRemaining
      },
      timestamp: update.timestamp
    };

    this.emitNotification(notification);
    this.logger.debug(`Progress update sent for upload ${update.uploadId}: ${update.progress}%`);
  }

  /**
   * Sends user feedback notification
   */
  sendUserFeedback(feedback: UserFeedback): void {
    const notification: NotificationEvent = {
      uploadId: feedback.uploadId,
      type: feedback.status === 'success' ? 'success' : feedback.status === 'error' ? 'error' : 'warning',
      message: feedback.message,
      data: {
        suggestions: feedback.suggestions,
        details: feedback.details
      },
      timestamp: feedback.timestamp
    };

    this.emitNotification(notification);
    this.logger.log(`User feedback sent for upload ${feedback.uploadId}: ${feedback.status}`);
  }

  /**
   * Sends processing report notification
   */
  sendProcessingReport(report: ProcessingReport): void {
    const notification: NotificationEvent = {
      uploadId: report.uploadId,
      type: report.status === 'completed' ? 'success' : report.status === 'failed' ? 'error' : 'warning',
      message: `Processing ${report.status}: ${report.summary.successfulRecords}/${report.summary.totalRecords} records processed`,
      data: {
        report,
        summary: report.summary,
        errors: report.errors,
        warnings: report.warnings,
        suggestions: report.suggestions
      },
      timestamp: report.generatedAt
    };

    this.emitNotification(notification);
    this.logger.log(`Processing report sent for upload ${report.uploadId}: ${report.status}`);
  }

  /**
   * Sends error notification
   */
  sendErrorNotification(uploadId: number, error: any): void {
    const notification: NotificationEvent = {
      uploadId,
      type: 'error',
      message: `Processing error: ${error.message || 'Unknown error occurred'}`,
      data: {
        error: error.message,
        details: error.details,
        retryable: error.retryable
      },
      timestamp: new Date()
    };

    this.emitNotification(notification);
    this.logger.error(`Error notification sent for upload ${uploadId}: ${error.message}`);
  }

  /**
   * Sends warning notification
   */
  sendWarningNotification(uploadId: number, warning: string, details?: any): void {
    const notification: NotificationEvent = {
      uploadId,
      type: 'warning',
      message: warning,
      data: details,
      timestamp: new Date()
    };

    this.emitNotification(notification);
    this.logger.warn(`Warning notification sent for upload ${uploadId}: ${warning}`);
  }

  /**
   * Sends success notification
   */
  sendSuccessNotification(uploadId: number, message: string, data?: any): void {
    const notification: NotificationEvent = {
      uploadId,
      type: 'success',
      message,
      data,
      timestamp: new Date()
    };

    this.emitNotification(notification);
    this.logger.log(`Success notification sent for upload ${uploadId}: ${message}`);
  }

  /**
   * Registers a connection for real-time updates
   */
  registerConnection(uploadId: number, connectionId: string): void {
    if (!this.activeConnections.has(uploadId)) {
      this.activeConnections.set(uploadId, new Set());
    }
    this.activeConnections.get(uploadId)!.add(connectionId);
    this.logger.debug(`Connection registered for upload ${uploadId}: ${connectionId}`);
  }

  /**
   * Unregisters a connection
   */
  unregisterConnection(uploadId: number, connectionId: string): void {
    const connections = this.activeConnections.get(uploadId);
    if (connections) {
      connections.delete(connectionId);
      if (connections.size === 0) {
        this.activeConnections.delete(uploadId);
      }
    }
    this.logger.debug(`Connection unregistered for upload ${uploadId}: ${connectionId}`);
  }

  /**
   * Gets active connections for an upload
   */
  getActiveConnections(uploadId: number): string[] {
    const connections = this.activeConnections.get(uploadId);
    return connections ? Array.from(connections) : [];
  }

  /**
   * Emits notification event
   */
  private emitNotification(notification: NotificationEvent): void {
    // Emit to EventEmitter2 for internal listeners
    this.eventEmitter.emit('csv.processing.notification', notification);

    // In a real implementation, you would also send via WebSocket
    this.sendWebSocketMessage(notification);
  }

  /**
   * Sends WebSocket message (placeholder for real implementation)
   */
  private sendWebSocketMessage(notification: NotificationEvent): void {
    const connections = this.getActiveConnections(notification.uploadId);
    
    if (connections.length > 0) {
      const message: WebSocketMessage = {
        type: notification.type,
        uploadId: notification.uploadId,
        data: notification.data,
        timestamp: notification.timestamp
      };

      // In a real implementation, you would send this via WebSocket
      // For now, we'll just log it
      this.logger.debug(`WebSocket message would be sent to ${connections.length} connections:`, message);
    }
  }

  /**
   * Broadcasts notification to all active connections
   */
  broadcastNotification(notification: NotificationEvent): void {
    this.emitNotification(notification);
    this.logger.debug(`Broadcast notification sent: ${notification.type}`);
  }

  /**
   * Sends batch notifications for multiple uploads
   */
  sendBatchNotifications(notifications: NotificationEvent[]): void {
    notifications.forEach(notification => {
      this.emitNotification(notification);
    });
    this.logger.debug(`Batch notifications sent: ${notifications.length} notifications`);
  }

  /**
   * Gets notification statistics
   */
  getNotificationStatistics(): {
    activeConnections: number;
    totalUploads: number;
    notificationsSent: number;
  } {
    const activeConnections = Array.from(this.activeConnections.values())
      .reduce((total, connections) => total + connections.size, 0);
    
    const totalUploads = this.activeConnections.size;
    
    // This would be tracked in a real implementation
    const notificationsSent = 0;

    return {
      activeConnections,
      totalUploads,
      notificationsSent
    };
  }

  /**
   * Cleans up inactive connections
   */
  cleanupInactiveConnections(): void {
    // In a real implementation, you would check connection health
    // and remove inactive connections
    this.logger.debug('Cleaning up inactive connections');
  }

  /**
   * Sends system status notification
   */
  sendSystemStatusNotification(status: 'healthy' | 'degraded' | 'unhealthy', message: string): void {
    const notification: NotificationEvent = {
      uploadId: 0, // System-wide notification
      type: status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'error',
      message: `System status: ${message}`,
      data: { status },
      timestamp: new Date()
    };

    this.broadcastNotification(notification);
    this.logger.log(`System status notification sent: ${status}`);
  }

  /**
   * Sends maintenance notification
   */
  sendMaintenanceNotification(message: string, scheduledTime?: Date): void {
    const notification: NotificationEvent = {
      uploadId: 0, // System-wide notification
      type: 'warning',
      message: `Maintenance: ${message}`,
      data: { scheduledTime },
      timestamp: new Date()
    };

    this.broadcastNotification(notification);
    this.logger.log(`Maintenance notification sent: ${message}`);
  }
}
