import { Controller, Get, Res, Req, UseGuards } from '@nestjs/common';
import type { Response, Request } from 'express';
import { JwtAuthGuard } from '../../../modules/auth/guards/jwt-auth.guard';
import { QueueRealtimeService } from './queue-realtime.service';

@Controller('emails/queue/realtime')
export class QueueRealtimeController {
  constructor(private readonly queueRealtimeService: QueueRealtimeService) {}

  /**
   * Server-Sent Events endpoint for real-time queue updates
   * GET /emails/queue/realtime
   * 
   * Clients connect to this endpoint and receive real-time updates
   * when queue status changes (emails sent, scheduled, etc.)
   */
  @UseGuards(JwtAuthGuard)
  @Get()
  async streamQueueUpdates(@Res() res: Response, @Req() req: Request) {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Get client ID from authenticated user (JWT guard sets req.user)
    const client = (req as any).user;
    if (!client?.id) {
      res.status(401).end();
      return;
    }

    // Register this client connection
    const clientId = `client-${client.id}`;
    this.queueRealtimeService.addClient(clientId, res);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to queue updates' })}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
      this.queueRealtimeService.removeClient(clientId);
      res.end();
    });
  }
}

