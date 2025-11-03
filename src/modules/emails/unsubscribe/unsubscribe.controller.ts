import { Controller, Get, Post, Param, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UnsubscribeService } from './unsubscribe.service';
import { IsOptional, IsString } from 'class-validator';

export class UnsubscribeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('emails/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly unsubscribeService: UnsubscribeService) {}

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
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .container { text-align: center; }
    .info { background-color: #e7f3ff; padding: 15px; border-radius: 4px; margin: 20px 0; text-align: left; }
    .success { background-color: #d4edda; padding: 15px; border-radius: 4px; margin: 20px 0; }
    .button { background-color: #28a745; color: white; padding: 10px 20px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin: 5px; }
    .button:hover { background-color: #218838; }
    .button-danger { background-color: #dc3545; }
    .button-danger:hover { background-color: #c82333; }
    .button-secondary { background-color: #6c757d; }
    .button-secondary:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; }
    .status-badge { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; }
    .status-unsubscribed { background-color: #ffc107; color: #000; }
    .status-subscribed { background-color: #28a745; color: white; }
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
        <p><strong>Unsubscribed on:</strong> ${new Date(history.unsubscribeRecord.unsubscribedAt).toLocaleString()}</p>
        ${history.unsubscribeRecord.reason ? `<p><strong>Reason:</strong> ${history.unsubscribeRecord.reason}</p>` : ''}
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
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .container { text-align: center; }
    .info { background-color: #e7f3ff; padding: 15px; border-radius: 4px; margin: 20px 0; }
    .button { background-color: #28a745; color: white; padding: 10px 20px; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; display: inline-block; margin: 5px; }
    .button:hover { background-color: #218838; }
    .button-secondary { background-color: #6c757d; }
    .button-secondary:hover { background-color: #5a6268; }
    .link { color: #007bff; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Email Subscription Status</h2>
    <div class="info">
      <p><strong>You are currently unsubscribed from our emails.</strong></p>
      <p style="font-size: 12px; color: #666;">
        Unsubscribed on: ${new Date(history.unsubscribeRecord.unsubscribedAt).toLocaleDateString()}
        ${history.unsubscribeRecord.reason ? `<br>Reason: ${history.unsubscribeRecord.reason}` : ''}
      </p>
    </div>
    <form method="POST" action="/emails/unsubscribe/resubscribe/${token}" style="display: inline;">
      <button type="submit" class="button">Resubscribe to Emails</button>
    </form>
    <a href="/emails/unsubscribe/history/${token}" class="button button-secondary">View Subscription History</a>
    <p style="margin-top: 20px; font-size: 12px; color: #999;">
      <a href="#" onclick="window.close();" class="link">Close</a>
    </p>
  </div>
</body>
</html>`;
        
        res.set('Content-Type', 'text/html');
        return res.send(html);
      }

      // Not unsubscribed - show unsubscribe form
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribe</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .container { text-align: center; }
    .button { background-color: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; border-radius: 4px; }
    .button:hover { background-color: #0056b3; }
    .link { color: #007bff; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Unsubscribe from Emails</h2>
    <p>Are you sure you want to unsubscribe from our emails?</p>
    <form method="POST" action="/emails/unsubscribe/${token}">
      <button type="submit" class="button">Yes, Unsubscribe</button>
    </form>
    <p style="margin-top: 20px; font-size: 12px; color: #999;">
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
      const result = await this.unsubscribeService.processUnsubscribe(token, body.reason);
      
      // Return confirmation page
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribed</title>
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
    <h2 class="success">✓ Successfully Unsubscribed</h2>
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
    <h2 class="error">Unsubscribe Failed</h2>
    <p>${error.message || 'An error occurred while processing your unsubscribe request.'}</p>
  </div>
</body>
</html>`;
      
      res.status(400).set('Content-Type', 'text/html').send(html);
    }
  }
}

