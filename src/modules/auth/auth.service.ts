import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../config/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordRequestDto, VerifyOtpAndResetPasswordDto } from './dto/forgot-password.dto';
import { OtpService } from '../../common/services/otp.service';
import { SendGridService } from '../emails/delivery/sendgrid/sendgrid.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  // In-memory storage for OTP (no database)
  private passwordResetOtpStore = new Map<string, { hash: string; expiresAt: Date; clientId: number }>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private otpService: OtpService,
    private sendGridService: SendGridService,
  ) {
    // Clean up expired OTPs every 5 minutes
    setInterval(() => {
      this.cleanupExpiredOtps();
    }, 5 * 60 * 1000);
  }

  async signup(signupDto: SignupDto) {
    const { email, password, productsServices, businessName, ...clientData } = signupDto;

    // Check if client already exists using Supabase strategy
    const existingClient = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.findUnique({
        where: { email },
      });
    });

    if (existingClient) {
      throw new ConflictException('Client with this email already exists');
    }

    // Hash password
    const saltRounds = 10;
    const hashPassword = await bcrypt.hash(password, saltRounds);

    // Get scraping client for ProductService creation
    const scrapingClient = await this.prisma.getScrapingClient();

    // Create client using Supabase strategy
    const client = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.create({
        data: {
          ...clientData,
          email,
          hashPassword,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          country: true,
          address: true,
          createdAt: true,
        },
      });
    });

    // Determine businessName: use provided businessName or fallback to client.name
    const finalBusinessName = businessName || client.name;

    // Create products/services records
    if (productsServices && productsServices.length > 0) {
      await scrapingClient.productService.createMany({
        data: productsServices.map(ps => ({
          clientId: client.id,
          name: ps.name,
          businessName: finalBusinessName,
          description: ps.description || null,
          type: ps.type || null,
        })),
      });
    }

    return client;
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const client = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.findUnique({
        where: { email },
      });
    });

    if (!client) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, client.hashPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { email: client.email, sub: client.id };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        city: client.city,
        country: client.country,
        address: client.address,
      },
    };
  }

  async validateClient(clientId: number) {
    const client = await this.prisma.safeFindUnique<any>(
      this.prisma.client,
      {
        where: { id: clientId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          country: true,
          address: true,
          createdAt: true,
        },
      }
    );

    return client;
  }

  async validateClientCredentials(email: string, password: string) {
    const client = await this.prisma.safeFindUnique<any>(
      this.prisma.client,
      { where: { email } }
    );

    if (!client) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, client.hashPassword);
    if (!isPasswordValid) {
      return null;
    }

    return {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      city: client.city,
      country: client.country,
      address: client.address,
    };
  }

  async getProfile(clientId: number) {
    const client = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          country: true,
          address: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    if (!client) {
      throw new UnauthorizedException('Client not found');
    }

    // Get products/services for the client
    const scrapingClient = await this.prisma.getScrapingClient();
    const productsServices = await scrapingClient.productService.findMany({
      where: { clientId },
      select: {
        id: true,
        name: true,
        businessName: true,
        description: true,
        type: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...client,
      productsServices,
    };
  }

  async updateProfile(clientId: number, updateProfileDto: UpdateProfileDto) {
    // Check if client exists
    const existingClient = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.findUnique({
        where: { id: clientId },
      });
    });

    if (!existingClient) {
      throw new UnauthorizedException('Client not found');
    }

    // Prepare update data
    const updateData: any = {};

    // Update regular profile fields if provided
    if (updateProfileDto.name !== undefined) {
      updateData.name = updateProfileDto.name;
    }
    if (updateProfileDto.phone !== undefined) {
      updateData.phone = updateProfileDto.phone;
    }
    if (updateProfileDto.city !== undefined) {
      updateData.city = updateProfileDto.city;
    }
    if (updateProfileDto.country !== undefined) {
      updateData.country = updateProfileDto.country;
    }
    if (updateProfileDto.address !== undefined) {
      updateData.address = updateProfileDto.address;
    }

    // Handle password update if currentPassword and newPassword are provided
    if (updateProfileDto.currentPassword && updateProfileDto.newPassword) {
      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(
        updateProfileDto.currentPassword,
        existingClient.hashPassword,
      );

      if (!isCurrentPasswordValid) {
        throw new UnauthorizedException('Current password is incorrect');
      }

      // Hash and set new password
      const saltRounds = 10;
      updateData.hashPassword = await bcrypt.hash(updateProfileDto.newPassword, saltRounds);
    } else if (updateProfileDto.newPassword && !updateProfileDto.currentPassword) {
      // If only newPassword is provided without currentPassword, throw error
      throw new UnauthorizedException('Current password is required to change password');
    } else if (updateProfileDto.currentPassword && !updateProfileDto.newPassword) {
      // If only currentPassword is provided without newPassword, throw error
      throw new UnauthorizedException('New password is required to change password');
    }

    // Update client profile if there's any data to update
    let updatedClient;
    if (Object.keys(updateData).length > 0) {
      updatedClient = await this.prisma.executeWithSupabaseStrategy(async () => {
        return await this.prisma.client.update({
          where: { id: clientId },
          data: updateData,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            city: true,
            country: true,
            address: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      });
    } else {
      // Get client without updating
      updatedClient = await this.prisma.executeWithSupabaseStrategy(async () => {
        return await this.prisma.client.findUnique({
          where: { id: clientId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            city: true,
            country: true,
            address: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      });
    }

    // Handle products/services update
    const scrapingClient = await this.prisma.getScrapingClient();
    
    if (updateProfileDto.productsServices !== undefined) {
      // Fetch existing businessName from any existing ProductService record for this client
      // If none exists, fallback to client.name
      const existingProductService = await scrapingClient.productService.findFirst({
        where: { clientId },
        select: { businessName: true },
        orderBy: { createdAt: 'asc' }, // Get the oldest one (from signup)
      });

      // Auto-fill businessName from existing record or use client name as fallback
      const autoFilledBusinessName = existingProductService?.businessName || existingClient.name;

      // Check if businessName is provided in the request (use first non-empty one if multiple)
      const providedBusinessName = updateProfileDto.productsServices
        .map(ps => ps.businessName)
        .find(bn => bn && bn.trim() !== '');

      // Use provided businessName if available, otherwise use auto-filled
      const finalBusinessName = providedBusinessName || autoFilledBusinessName;

      // Get existing products/services
      const existingProductsServices = await scrapingClient.productService.findMany({
        where: { clientId },
        select: { id: true },
      });

      const existingIds = new Set(existingProductsServices.map(ps => ps.id));
      const incomingIds = new Set(
        updateProfileDto.productsServices
          .filter(ps => ps.id !== undefined)
          .map(ps => ps.id)
      );

      // Delete products/services that are not in the incoming array
      const idsToDelete = Array.from(existingIds).filter(id => !incomingIds.has(id));
      if (idsToDelete.length > 0) {
        await scrapingClient.productService.deleteMany({
          where: {
            id: { in: idsToDelete },
            clientId,
          },
        });
      }

      // Update or create products/services
      for (const ps of updateProfileDto.productsServices) {
        // Use businessName from this specific item if provided, otherwise use the finalBusinessName
        const itemBusinessName = (ps.businessName && ps.businessName.trim() !== '') 
          ? ps.businessName 
          : finalBusinessName;

        if (ps.id && incomingIds.has(ps.id)) {
          // Update existing - use provided businessName or fallback to auto-filled
          await scrapingClient.productService.update({
            where: { id: ps.id },
            data: {
              name: ps.name,
              businessName: itemBusinessName,
              description: ps.description || null,
              type: ps.type || null,
            },
          });
        } else {
          // Create new - use provided businessName or fallback to auto-filled
          await scrapingClient.productService.create({
            data: {
              clientId,
              name: ps.name,
              businessName: itemBusinessName,
              description: ps.description || null,
              type: ps.type || null,
            },
          });
        }
      }
    }

    // Get updated products/services
    const productsServices = await scrapingClient.productService.findMany({
      where: { clientId },
      select: {
        id: true,
        name: true,
        businessName: true,
        description: true,
        type: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Check if there's anything to update (client fields or products/services)
    if (Object.keys(updateData).length === 0 && updateProfileDto.productsServices === undefined) {
      throw new BadRequestException('No fields provided to update');
    }

    return {
      ...updatedClient,
      productsServices,
    };
  }

  /**
   * Request password reset - sends OTP to user's email
   */
  async requestForgotPassword(forgotPasswordDto: ForgotPasswordRequestDto) {
    const { email } = forgotPasswordDto;

    // Find client by email
    const client = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.findUnique({
        where: { email },
      });
    });

    // Security: Don't reveal if email exists (prevent email enumeration)
    if (!client) {
      return {
        message: 'If the email exists, a password reset code has been sent.',
        success: true,
        codeSent: false, // Indicates no code was actually sent
      };
    }

    // Generate OTP
    const code = this.otpService.generateCode();
    const hash = this.otpService.hashCode(code);
    const expiresAt = this.otpService.getExpiry();

    // Store in memory (key: email, value: { hash, expiresAt, clientId })
    this.passwordResetOtpStore.set(email, {
      hash,
      expiresAt,
      clientId: client.id,
    });

    // Send OTP email
    const html = `
      <p>Hi ${client.name || 'there'},</p>
      <p>You requested to reset your password. Use the code below to verify your identity:</p>
      <p style="font-size: 24px; letter-spacing: 4px; font-weight: bold; text-align: center; padding: 20px; background-color: #f5f5f5; border-radius: 5px; margin: 20px 0;">
        ${code}
      </p>
      <p>This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
      <p>For security reasons, do not share this code with anyone.</p>
    `;

    const fromEmail = process.env.VERIFICATION_EMAIL_FROM || 'noreply@bytesplatform.com';
    await this.sendGridService.sendEmail(
      email,
      fromEmail,
      'Password Reset Verification Code',
      html,
    );

    this.otpService.logSend('email', this.otpService.maskTarget(email), expiresAt);

    return {
      message: 'Password reset code has been sent to your email.',
      success: true,
      codeSent: true, // Indicates code was sent
      maskedEmail: this.otpService.maskTarget(email),
      expiresAt,
    };
  }

  /**
   * Verify OTP and reset password
   */
  async verifyOtpAndResetPassword(resetPasswordDto: VerifyOtpAndResetPasswordDto) {
    const { email, otp, newPassword } = resetPasswordDto;

    // Get stored OTP data from memory
    const storedOtp = this.passwordResetOtpStore.get(email);

    if (!storedOtp) {
      throw new BadRequestException('No password reset request found. Please request a new code.');
    }

    // Check if OTP is expired
    if (this.otpService.isExpired(storedOtp.expiresAt)) {
      // Remove expired OTP
      this.passwordResetOtpStore.delete(email);
      throw new BadRequestException('OTP has expired. Please request a new code.');
    }

    // Verify OTP
    const hashed = this.otpService.hashCode(otp);
    if (hashed !== storedOtp.hash) {
      throw new BadRequestException('Invalid OTP. Please try again.');
    }

    // Find client
    const client = await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.findUnique({
        where: { id: storedOtp.clientId },
      });
    });

    if (!client) {
      this.passwordResetOtpStore.delete(email);
      throw new UnauthorizedException('Client not found');
    }

    // Verify email matches
    if (client.email !== email) {
      this.passwordResetOtpStore.delete(email);
      throw new UnauthorizedException('Email mismatch');
    }

    // Hash new password
    const saltRounds = 10;
    const hashPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await this.prisma.executeWithSupabaseStrategy(async () => {
      return await this.prisma.client.update({
        where: { id: client.id },
        data: { hashPassword },
      });
    });

    // Remove OTP from memory after successful reset
    this.passwordResetOtpStore.delete(email);

    return {
      message: 'Password reset successfully',
      success: true,
    };
  }

  /**
   * Clean up expired OTPs from memory
   */
  private cleanupExpiredOtps() {
    const now = Date.now();
    for (const [email, data] of this.passwordResetOtpStore.entries()) {
      if (data.expiresAt.getTime() < now) {
        this.passwordResetOtpStore.delete(email);
      }
    }
  }
}