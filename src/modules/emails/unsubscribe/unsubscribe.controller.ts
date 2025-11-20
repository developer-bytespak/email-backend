import { Controller, Get, Post, Param, Body, Res, UseGuards, Request, ParseIntPipe, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { UnsubscribeService } from './unsubscribe.service';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

export class UnsubscribeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('emails/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly unsubscribeService: UnsubscribeService) {}

  /**
   * Get unsubscribe records for the authenticated client
   * GET /emails/unsubscribe/all
   */
  @UseGuards(JwtAuthGuard)
  @Get('all')
  async getAllUnsubscribes(@Request() req) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    const data = await this.unsubscribeService.getClientUnsubscribes(clientId);
    return {
      success: true,
      count: data.length,
      data,
    };
  }

  /**
   * Resubscribe by contact id (dashboard API)
   * POST /emails/unsubscribe/admin/resubscribe/:contactId
   */
  @UseGuards(JwtAuthGuard)
  @Post('admin/resubscribe/:contactId')
  async resubscribeByContact(
    @Request() req,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    const clientId = req.user.id;
    return this.unsubscribeService.resubscribeByContactId(clientId, contactId);
  }

  /**
   * Get unsubscribe history (GET)
   * GET /emails/unsubscribe/history/:token
   * Must come before :token route to avoid route conflicts
   */
  @Get('history/:token')
  async getUnsubscribeHistory(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const history = await this.unsubscribeService.getUnsubscribeHistory(token);

      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Subscription History</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    h2 { color: #333; margin-bottom: 20px; }
    .info { background-color: #e7f3ff; padding: 20px; border-radius: 4px; margin: 20px 0; text-align: left; }
    .success { background-color: #d4edda; padding: 20px; border-radius: 4px; margin: 20px 0; }
    .button { background-color: #28a745; color: white; padding: 12px 24px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin: 5px; font-size: 16px; font-weight: bold; }
    .button:hover { background-color: #218838; }
    .button-danger { background-color: #dc3545; }
    .button-danger:hover { background-color: #c82333; }
    .button-secondary { background-color: #6c757d; }
    .button-secondary:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; cursor: pointer; }
    .status-badge { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; }
    .status-unsubscribed { background-color: #ffc107; color: #000; }
    .status-subscribed { background-color: #28a745; color: white; }
    .reason-box { background-color: #f8f9fa; padding: 12px; border-radius: 4px; margin-top: 10px; border-left: 3px solid #007bff; }
    .reason-box p { margin: 5px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Email Subscription History</h2>
    
    ${history.isUnsubscribed ? `
    <div class="info">
      <p><strong>Status:</strong> <span class="status-badge status-unsubscribed">Unsubscribed</span></p>
      <p><strong>Email:</strong> ${history.contactEmail}</p>
      ${history.unsubscribeRecord ? `
        <p style="margin-top: 10px;"><strong>Unsubscribed on:</strong> ${new Date(history.unsubscribeRecord.unsubscribedAt).toLocaleString()}</p>
        ${history.unsubscribeRecord.reason ? `
        <div class="reason-box">
          <strong>Reason:</strong>
          <p>${history.unsubscribeRecord.reason}</p>
        </div>
        ` : ''}
      ` : ''}
    </div>
    <form method="POST" action="/emails/unsubscribe/resubscribe/${token}" style="display: inline;">
      <button type="submit" class="button">Resubscribe to Emails</button>
    </form>
    ` : `
    <div class="success">
      <p><strong>Status:</strong> <span class="status-badge status-subscribed">Subscribed</span></p>
      <p><strong>Email:</strong> ${history.contactEmail}</p>
      <p>You are currently subscribed to receive emails from us.</p>
    </div>
    <form method="POST" action="/emails/unsubscribe/${token}" style="display: inline;">
      <button type="submit" class="button button-danger">Unsubscribe</button>
    </form>
    `}
    
    <p style="margin-top: 20px; font-size: 12px; color: #999;">
      <a href="#" onclick="window.close();" class="link">Close</a>
    </p>
  </div>
</body>
</html>`;

      res.set('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
    .error { color: #dc3545; }
  </style>
</head>
<body>
  <div>
    <h2 class="error">Error</h2>
    <p>${error.message || 'An error occurred while retrieving subscription history.'}</p>
  </div>
</body>
</html>`;
      
      res.status(400).set('Content-Type', 'text/html').send(html);
    }
  }

  /**
   * Resubscribe contact (POST)
   * POST /emails/unsubscribe/resubscribe/:token
   */
  @Post('resubscribe/:token')
  async resubscribe(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.unsubscribeService.resubscribe(token);
      
      // Return confirmation page
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Resubscribed</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
    .success { color: #28a745; }
    .button { background-color: #6c757d; color: white; padding: 10px 20px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin: 10px 5px; }
    .button:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; }
  </style>
</head>
<body>
  <div>
    <h2 class="success">✓ Successfully Resubscribed</h2>
    <p>${result.message}</p>
    <p style="margin-top: 20px;">
      <a href="/emails/unsubscribe/history/${token}" class="button">View Subscription History</a>
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 20px;">
      <a href="#" onclick="window.close();" class="link">Close this window</a>
    </p>
  </div>
</body>
</html>`;
      
      res.set('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
    .error { color: #dc3545; }
  </style>
</head>
<body>
  <div>
    <h2 class="error">Resubscribe Failed</h2>
    <p>${error.message || 'An error occurred while processing your resubscribe request.'}</p>
  </div>
</body>
</html>`;
      
      res.status(400).set('Content-Type', 'text/html').send(html);
    }
  }

  /**
   * Unsubscribe page/form (GET)
   * GET /emails/unsubscribe/:token
   * Enhanced to check if already unsubscribed and show resubscribe option
   */
  @Get(':token')
  async unsubscribePage(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      // Check if already unsubscribed
      const history = await this.unsubscribeService.getUnsubscribeHistory(token);

      if (history.isUnsubscribed && history.unsubscribeRecord) {
        // Already unsubscribed - show resubscribe option
        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribe Status</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    h2 { color: #333; margin-bottom: 20px; }
    .info { background-color: #e7f3ff; padding: 20px; border-radius: 4px; margin: 20px 0; text-align: left; }
    .info p { margin: 8px 0; }
    .info strong { color: #333; }
    .reason-box { background-color: #f8f9fa; padding: 12px; border-radius: 4px; margin-top: 10px; border-left: 3px solid #007bff; }
    .button { background-color: #28a745; color: white; padding: 12px 24px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin: 5px; font-size: 16px; font-weight: bold; }
    .button:hover { background-color: #218838; }
    .button-secondary { background-color: #6c757d; }
    .button-secondary:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; cursor: pointer; }
    .button-group { margin-top: 25px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Email Subscription Status</h2>
    <div class="info">
      <p><strong>You are currently unsubscribed from our emails.</strong></p>
      <p style="font-size: 14px; color: #666; margin-top: 10px;">
        <strong>Unsubscribed on:</strong> ${new Date(history.unsubscribeRecord.unsubscribedAt).toLocaleString()}
      </p>
      ${history.unsubscribeRecord.reason ? `
      <div class="reason-box">
        <strong style="color: #555;">Reason:</strong>
        <p style="margin: 5px 0 0 0; color: #666;">${history.unsubscribeRecord.reason}</p>
      </div>
      ` : ''}
    </div>
    <div class="button-group">
      <form method="POST" action="/emails/unsubscribe/resubscribe/${token}" style="display: inline;">
        <button type="submit" class="button">Resubscribe to Emails</button>
      </form>
      <a href="/emails/unsubscribe/history/${token}" class="button button-secondary">View Subscription History</a>
    </div>
    <p style="margin-top: 20px; font-size: 12px; color: #999;">
      <a href="#" onclick="window.close();" class="link">Close</a>
    </p>
  </div>
</body>
</html>`;
        
        res.set('Content-Type', 'text/html');
        return res.send(html);
      }

      // Not unsubscribed - show unsubscribe form with reason field
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribe</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h2 { color: #333; margin-bottom: 20px; text-align: center; }
    .form-group { margin-bottom: 20px; text-align: left; }
    label { display: block; margin-bottom: 8px; color: #555; font-weight: bold; }
    label .required { color: #dc3545; }
    textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-family: Arial, sans-serif; font-size: 14px; resize: vertical; min-height: 100px; box-sizing: border-box; }
    textarea:focus { outline: none; border-color: #007bff; }
    .error { color: #dc3545; font-size: 12px; margin-top: 5px; display: none; }
    .button { background-color: #dc3545; color: white; padding: 12px 24px; border: none; cursor: pointer; border-radius: 4px; font-size: 16px; font-weight: bold; width: 100%; margin-top: 10px; }
    .button:hover { background-color: #c82333; }
    .button-secondary { background-color: #6c757d; margin-top: 10px; }
    .button-secondary:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; cursor: pointer; }
    .help-text { font-size: 12px; color: #666; margin-top: 5px; }
    .resubscribe-section { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
    .resubscribe-section p { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Unsubscribe from Emails</h2>
    <p style="text-align: center; color: #666; margin-bottom: 25px;">We're sorry to see you go. If you'd like, you can let us know why you're unsubscribing.</p>
    
    <form method="POST" action="/emails/unsubscribe/${token}" id="unsubscribeForm">
      <div class="form-group">
        <label for="reason">Reason for Unsubscribing (Optional)</label>
        <textarea 
          id="reason" 
          name="reason" 
          placeholder="Please tell us why you're unsubscribing (e.g., too many emails, not relevant, etc.) - Optional"
        ></textarea>
        <div class="help-text">This helps us improve our email communications. You can skip this if you prefer.</div>
      </div>
      
      <button type="submit" class="button">Confirm Unsubscribe</button>
    </form>
    
    <div class="resubscribe-section">
      <p style="text-align: center; margin-bottom: 10px;">Changed your mind?</p>
      <form method="POST" action="/emails/unsubscribe/resubscribe/${token}" style="display: inline; width: 100%;">
        <button type="submit" class="button button-secondary">Resubscribe to Emails</button>
      </form>
    </div>
    
    <p style="margin-top: 20px; font-size: 12px; color: #999; text-align: center;">
      <a href="#" onclick="window.close();" class="link">Cancel</a>
    </p>
  </div>
</body>
</html>`;
      
      res.set('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      // If token is invalid, show error
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
    .error { color: #dc3545; }
  </style>
</head>
<body>
  <div>
    <h2 class="error">Invalid Link</h2>
    <p>${error.message || 'This unsubscribe link is invalid or has expired.'}</p>
  </div>
</body>
</html>`;
      
      res.status(400).set('Content-Type', 'text/html').send(html);
    }
  }

  /**
   * Process unsubscribe (POST)
   * POST /emails/unsubscribe/:token
   */
  @Post(':token')
  async processUnsubscribe(
    @Param('token') token: string,
    @Body() body: UnsubscribeDto,
    @Res() res: Response,
  ) {
    try {
      // Process unsubscribe with optional reason
      const reason = body.reason?.trim() || undefined;
      const result = await this.unsubscribeService.processUnsubscribe(token, reason);
      
      // Return confirmation page with resubscribe option
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribed</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    .success { color: #28a745; font-size: 24px; margin-bottom: 15px; }
    .message { color: #666; margin-bottom: 25px; }
    .button { background-color: #28a745; color: white; padding: 12px 24px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin: 5px; font-size: 16px; }
    .button:hover { background-color: #218838; }
    .button-secondary { background-color: #6c757d; }
    .button-secondary:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; cursor: pointer; }
    .resubscribe-section { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <h2 class="success">✓ Successfully Unsubscribed</h2>
    <p class="message">${result.message}</p>
    <p class="message" style="font-size: 14px;">Thank you for your feedback. We appreciate you taking the time to let us know why you're unsubscribing.</p>
    
    <div class="resubscribe-section">
      <p style="color: #666; margin-bottom: 15px;">Changed your mind?</p>
      <form method="POST" action="/emails/unsubscribe/resubscribe/${token}" style="display: inline;">
        <button type="submit" class="button">Resubscribe to Emails</button>
      </form>
    </div>
    
    <p style="margin-top: 20px;">
      <a href="/emails/unsubscribe/history/${token}" class="button button-secondary">View Subscription History</a>
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 20px;">
      <a href="#" onclick="window.close();" class="link">Close this window</a>
    </p>
  </div>
</body>
</html>`;
      
      res.set('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    .error { color: #dc3545; }
    .button { background-color: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin-top: 20px; }
    .button:hover { background-color: #0056b3; }
  </style>
</head>
<body>
  <div class="container">
    <h2 class="error">Unsubscribe Failed</h2>
    <p>${error.message || 'An error occurred while processing your unsubscribe request.'}</p>
    <a href="/emails/unsubscribe/${token}" class="button">Try Again</a>
  </div>
</body>
</html>`;
      
      res.status(400).set('Content-Type', 'text/html').send(html);
    }
  }
}

