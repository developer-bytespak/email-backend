export const emailConfig = {
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },
  from: {
    name: process.env.EMAIL_FROM_NAME || 'Email Backend',
    email: process.env.EMAIL_FROM_EMAIL || 'noreply@example.com',
  },
  limits: {
    dailyLimit: parseInt(process.env.DAILY_EMAIL_LIMIT) || 1000,
    hourlyLimit: parseInt(process.env.HOURLY_EMAIL_LIMIT) || 100,
  },
};
