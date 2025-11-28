import { IsEmail, IsString, MinLength } from 'class-validator';

export class ForgotPasswordRequestDto {
  @IsEmail()
  email: string;
}

export class VerifyOtpAndResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  otp: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  newPassword: string;
}

