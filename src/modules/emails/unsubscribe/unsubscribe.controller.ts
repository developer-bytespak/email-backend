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
   * Unsubscribe page/form (GET)
   * GET /emails/unsubscribe/:token
   */
  @Get(':token')
  async unsubscribePage(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    // Simple HTML page for unsubscribe
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
      <a href="#" onclick="window.close();">Cancel</a>
    </p>
  </div>
</body>
</html>`;
    
    res.set('Content-Type', 'text/html');
    res.send(html);
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
  </style>
</head>
<body>
  <div>
    <h2 class="success">✓ Successfully Unsubscribed</h2>
    <p>${result.message}</p>
    <p style="font-size: 12px; color: #999;">You can close this window.</p>
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

