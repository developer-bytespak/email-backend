import { Controller, Post, Param, ParseIntPipe, Body, HttpException, HttpStatus, Req, Res } from '@nestjs/common';
import { SmsService } from '../sms.service';

@Controller('sms')
export class SmsTwilioController {
  constructor(private readonly smsService: SmsService) {}

  // Note: Send draft endpoint moved to main SmsController
  // Use POST /sms/send-draft instead

  /**
   * Webhook endpoint for Twilio SMS status updates
   * POST /sms/webhook/status
   * Twilio sends status updates (delivered, failed, undelivered) here
   * 
   * IMPORTANT: Responds immediately to avoid timeout, processes update in background
   */
  @Post('webhook/status')
  handleStatusWebhook(@Req() req: any, @Res() res: any) {
    // Extract data from Twilio request
    const messageSid = req.body.MessageSid || req.body.messageSid;
    const messageStatus = req.body.MessageStatus || req.body.messageStatus;
    const errorCode = req.body.ErrorCode || req.body.errorCode;
    const errorMessage = req.body.ErrorMessage || req.body.errorMessage;

    // Log incoming webhook
    console.log('📥 Twilio webhook received:', {
      MessageSid: messageSid,
      MessageStatus: messageStatus,
    });

    // CRITICAL: Respond to Twilio IMMEDIATELY to prevent timeout
    // Respond FIRST before any async processing
    res.type('text/xml');
    res.status(200);
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    res.end(); // Explicitly end the response

    // Validate required fields (after responding)
    if (!messageSid || !messageStatus) {
      console.error('❌ Missing MessageSid or MessageStatus in webhook');
      return; // Already responded, just return
    }

    // Process the status update ASYNCHRONOUSLY in the background
    // This prevents Twilio timeout while still updating the database
    setImmediate(async () => {
      try {
        await this.smsService.updateSmsStatus(messageSid, messageStatus, errorCode, errorMessage);
        console.log(`✅ Webhook processed successfully for MessageSid: ${messageSid}`);
      } catch (error) {
        console.error(`❌ Error processing webhook for MessageSid ${messageSid}:`, error);
        // Don't throw - we already responded to Twilio
      }
    });
  }
}


