import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../config/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto) {
    const { email, password, productsServices, companyName, companyDescription, ...clientData } = signupDto;

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

    // Create products/services records
    if (productsServices && productsServices.length > 0) {
      await scrapingClient.productService.createMany({
        data: productsServices.map(ps => ({
          clientId: client.id,
          name: ps.name,
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
        if (ps.id && incomingIds.has(ps.id)) {
          // Update existing
          await scrapingClient.productService.update({
            where: { id: ps.id },
            data: {
              name: ps.name,
              description: ps.description || null,
              type: ps.type || null,
            },
          });
        } else {
          // Create new
          await scrapingClient.productService.create({
            data: {
              clientId,
              name: ps.name,
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
}