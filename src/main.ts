import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import * as express from 'express';

// Load environment variables from .env file
dotenv.config();

async function bootstrap() {
  // Make sure debug logs are enabled
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'], // Include 'debug'
  });

  // IMPORTANT: Raw body parser for webhook signature verification
  // Must be added BEFORE JSON parser for the webhook route
  app.use('/emails/webhooks/sendgrid', express.raw({ type: 'application/json' }));

  // JSON parser for all other routes
  app.use(express.json());

  // Enable CORS for frontend
  app.enableCors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        'http://localhost:3001',
        'https://email-backend-izs4.onrender.com',
        process.env.FRONTEND_URL,
      ].filter(Boolean);

      // Allow all Vercel preview and production deployments
      const isVercelDomain = /^https:\/\/.*\.vercel\.app$/.test(origin);

      if (allowedOrigins.includes(origin) || isVercelDomain) {
        callback(null, true);
      } else {
        callback(null, true); // Allow all for now - restrict if needed
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    optionsSuccessStatus: 200,
  });

  // Enable cookie parsing
  app.use(cookieParser());

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
