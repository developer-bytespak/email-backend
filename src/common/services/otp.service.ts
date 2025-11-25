import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly otpLength = Number(process.env.SENDER_VERIFICATION_OTP_LENGTH || '6');
  private readonly otpTtlMs = Number(process.env.SENDER_VERIFICATION_OTP_TTL_SECONDS || '600') * 1000;
  private readonly otpSecret = process.env.SENDER_VERIFICATION_OTP_SECRET || 'sender-verification-secret';

  generateCode(): string {
    const max = 10 ** this.otpLength;
    const value = crypto.randomInt(0, max);
    return value.toString().padStart(this.otpLength, '0');
  }

  hashCode(code: string): string {
    return crypto.createHmac('sha256', this.otpSecret).update(code).digest('hex');
  }

  isExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() < Date.now();
  }

  getExpiry(): Date {
    return new Date(Date.now() + this.otpTtlMs);
  }

  maskTarget(target: string): string {
    if (!target) return '';
    const [local, domain] = target.split('@');
    if (domain) {
      const maskedLocal = `${local.slice(0, 2)}***${local.slice(-1)}`;
      return `${maskedLocal}@${domain}`;
    }
    const digits = target.replace(/\D/g, '');
    if (digits.length < 4) {
      return '***';
    }
    return `***${digits.slice(-4)}`;
  }

  logSend(channel: 'email' | 'sms', identifier: string, expiresAt: Date) {
    this.logger.log(
      `OTP issued for ${channel.toUpperCase()} ${identifier} (expires ${expiresAt.toISOString()})`,
    );
  }
}


