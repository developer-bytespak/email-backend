import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Response,
  HttpCode,
  HttpStatus,
  Get,
  Put,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordRequestDto, VerifyOtpAndResetPasswordDto } from './dto/forgot-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  @Post('signup')
  async signup(
    @Body() signupDto: SignupDto,
    @Response({ passthrough: true }) res,
  ) {
    const client = await this.authService.signup(signupDto);
    
    // Auto-login after signup: generate token and set cookie
    const payload = { email: client.email, sub: client.id };
    const access_token = this.jwtService.sign(payload);
    
    // Set HTTP-only cookie (same settings as login)
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    return {
      message: 'Registration successful',
      client,
      access_token, // Include token for frontend to store in localStorage
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Response({ passthrough: true }) res,
  ) {
    const result = await this.authService.login(loginDto);
    
    // Set HTTP-only cookie
    // Use 'none' for cross-origin (Vercel frontend -> Render backend)
    // secure must be true when sameSite is 'none' (required by browsers)
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: isProduction, // Required for sameSite: 'none'
      sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-origin, 'lax' for local dev
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/', // Ensure cookie is available for all paths
    });

    return {
      message: 'Login successful',
      client: result.client,
      access_token: result.access_token, // Include token for testing purposes
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Response({ passthrough: true }) res) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
    return { message: 'Logout successful' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    const profile = await this.authService.getProfile(req.user.id);
    return {
      message: 'Profile retrieved successfully',
      profile,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    const updatedProfile = await this.authService.updateProfile(req.user.id, updateProfileDto);
    return {
      message: 'Profile updated successfully',
      profile: updatedProfile,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verifyToken(@Request() req) {
    return {
      valid: true,
      client: req.user,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordRequestDto) {
    return await this.authService.requestForgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: VerifyOtpAndResetPasswordDto) {
    return await this.authService.verifyOtpAndResetPassword(resetPasswordDto);
  }
}
