import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OtpService } from '../../common/services/otp.service';
import { SendGridModule } from '../emails/delivery/sendgrid/sendgrid.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    SendGridModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, OtpService],
  exports: [AuthService],
})
export class AuthModule {}
