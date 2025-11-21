import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface ClientConnection {
  id: string;
  response: Response;
}

@Injectable()
export class QueueRealtimeService {
  private readonly logger = new Logger(QueueRealtimeService.name);
  private clients = new Map<string, ClientConnection>();

  /**
   * Add a client connection
   */
  addClient(clientId: string, response: Response): void {
    this.clients.set(clientId, { id: clientId, response });
    this.logger.log(`Client connected: ${clientId} (Total: ${this.clients.size})`);
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string): void {
    if (this.clients.delete(clientId)) {
      this.logger.log(`Client disconnected: ${clientId} (Total: ${this.clients.size})`);
    }
  }

  /**
   * Broadcast update to all connected clients
   */
  private broadcastToClients(update: any): void {
    const message = `data: ${JSON.stringify(update)}\n\n`;
    
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.response.write(message);
      } catch (error) {
        // Client disconnected, remove from map
        this.logger.warn(`Failed to send to client ${clientId}, removing:`, error);
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Send update to specific client
   */
  sendToClient(clientId: string, update: any): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        const message = `data: ${JSON.stringify(update)}\n\n`;
        client.response.write(message);
      } catch (error) {
        this.logger.warn(`Failed to send to client ${clientId}:`, error);
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Publish queue update - broadcasts directly to all connected clients
   */
  async publishQueueUpdate(update: {
    type: 'queue:status' | 'queue:sent' | 'queue:added' | 'queue:removed';
    queueId?: number;
    emailDraftId?: number;
    status?: string;
    data?: any;
  }): Promise<void> {
    // Broadcast directly to all connected clients (no Redis needed)
    this.broadcastToClients(update);
  }
}

