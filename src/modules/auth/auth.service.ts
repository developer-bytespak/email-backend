import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../config/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto) {
    const { email, password, ...clientData } = signupDto;

    // Use scraping client to avoid prepared statement conflicts
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Check if client already exists
    const existingClient = await scrapingClient.client.findUnique({
      where: { email },
    });

    if (existingClient) {
      throw new ConflictException('Client with this email already exists');
    }

    // Hash password
    const saltRounds = 10;
    const hashPassword = await bcrypt.hash(password, saltRounds);

    // Create client
    const client = await scrapingClient.client.create({
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

    return client;
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Use scraping client to avoid prepared statement conflicts
    const scrapingClient = await this.prisma.getScrapingClient();
    const client = await scrapingClient.client.findUnique({
      where: { email },
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
    // Use scraping client to avoid prepared statement conflicts
    const scrapingClient = await this.prisma.getScrapingClient();
    const client = await scrapingClient.client.findUnique({
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
    });

    return client;
  }

  async validateClientCredentials(email: string, password: string) {
    // Use scraping client to avoid prepared statement conflicts
    const scrapingClient = await this.prisma.getScrapingClient();
    const client = await scrapingClient.client.findUnique({
      where: { email },
    });

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
}
