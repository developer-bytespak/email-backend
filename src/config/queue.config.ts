export const queueConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  queues: {
    email: {
      name: 'email-queue',
      concurrency: parseInt(process.env.EMAIL_QUEUE_CONCURRENCY || '5'),
    },
    processing: {
      name: 'processing-queue',
      concurrency: parseInt(process.env.PROCESSING_QUEUE_CONCURRENCY || '3'),
    },
    webhooks: {
      name: 'webhook-queue',
      concurrency: parseInt(process.env.WEBHOOK_QUEUE_CONCURRENCY || '10'),
    },
  },
};
