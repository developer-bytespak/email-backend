import {
  Controller,
  Post,
  Get,
  UploadedFile,
  UseInterceptors,
  Body,
  UseGuards,
  Request,
  Param,
  Query,
  ParseIntPipe,
  NotFoundException,
  ForbiddenException,
  Patch,
  BadRequestException,
  Res,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetContactsQueryDto } from './dto/get-contacts-query.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { BulkUpdateContactsDto } from './dto/bulk-update-contacts.dto';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(
    @Request() req,
    @UploadedFile() file: any,
    @Body('clientId') clientId?: string,
  ) {
    // Use authenticated client ID from JWT token (security: ignore clientId from body)
    const authenticatedClientId = req.user.id;
    
    // Log warning if clientId in body doesn't match authenticated client (potential security issue)
    if (clientId && parseInt(clientId) !== authenticatedClientId) {
      console.warn(`Security: Client ${authenticatedClientId} attempted to upload with mismatched clientId ${clientId}. Using authenticated client ID.`);
    }
    
    return this.ingestionService.processCsvUpload(file, authenticatedClientId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('uploads')
  async getClientUploads(@Request() req) {
    const clientId = req.user.id;
    const uploads = await this.ingestionService.getClientUploads(clientId);
    
    return {
      message: 'CSV uploads retrieved successfully',
      count: uploads.length,
      uploads,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('upload/:id')
  async getUploadById(
    @Request() req,
    @Param('id', ParseIntPipe) uploadId: number,
  ) {
    const clientId = req.user.id;
    const upload = await this.ingestionService.getUploadById(uploadId);
    
    if (!upload) {
      throw new NotFoundException(`Upload with ID ${uploadId} not found`);
    }
    
    // Ensure the upload belongs to the authenticated client
    if (upload.clientId !== clientId) {
      throw new ForbiddenException('You do not have access to this upload');
    }
    
    return {
      message: 'Upload retrieved successfully',
      upload,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('contacts')
  async listContacts(@Request() req, @Query() query: GetContactsQueryDto, @Res() res: any) {
    const clientId = req.user.id;
    const validatedQuery = this.validateDto(query, GetContactsQueryDto);

    // Disable caching for this endpoint to ensure fresh data
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const result = await this.ingestionService.listContacts(clientId, validatedQuery);
    return res.json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Get('contacts/all')
  async getAllClientContacts(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('valid') valid?: string,
  ) {
    const clientId = req.user.id;
    // Only parse limit if provided; undefined means return all contacts
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;

    const contacts = await this.ingestionService.getAllClientContacts(clientId, {
      limit: parsedLimit,
      status,
      valid: valid === 'true' ? true : valid === 'false' ? false : undefined,
    });

    return {
      message: 'All client contacts retrieved successfully',
      count: contacts.length,
      contacts,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('contacts/invalid')
  async getAllInvalidContacts(@Request() req) {
    const clientId = req.user.id;
    const contacts = await this.ingestionService.getAllInvalidContacts(clientId);

    return {
      message: 'All invalid contacts retrieved successfully',
      count: contacts.length,
      contacts,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('contacts/invalid/bulk')
  async bulkDeleteInvalidContacts(@Request() req) {
    const clientId = req.user.id;
    const result = await this.ingestionService.bulkDeleteInvalidContacts(clientId);

    return {
      message: `Successfully deleted ${result.deletedCount} invalid contact(s)`,
      deletedCount: result.deletedCount,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('contacts/:id')
  async getContact(
    @Request() req,
    @Param('id', ParseIntPipe) contactId: number,
  ) {
    const clientId = req.user.id;
    return this.ingestionService.getContactById(clientId, contactId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('contacts/:id')
  async deleteContact(
    @Request() req,
    @Param('id', ParseIntPipe) contactId: number,
  ) {
    const clientId = req.user.id;
    const result = await this.ingestionService.deleteContact(clientId, contactId);

    return {
      message: 'Contact deleted successfully',
      deleted: result.deleted,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('contacts/bulk')
  async bulkUpdateContacts(
    @Request() req,
    @Body() body: BulkUpdateContactsDto,
  ) {
    const clientId = req.user.id;
    const validatedBody = this.validateDto(body, BulkUpdateContactsDto);

    return this.ingestionService.bulkUpdateContacts(clientId, validatedBody);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('contacts/:id')
  async updateContact(
    @Request() req,
    @Param('id', ParseIntPipe) contactId: number,
    @Body() body: UpdateContactDto,
  ) {
    const clientId = req.user.id;
    const validatedBody = this.validateDto(body, UpdateContactDto);

    return this.ingestionService.updateContact(clientId, contactId, validatedBody);
  }

  private validateDto<T>(payload: unknown, dtoClass: ClassConstructor<T>): T {
    const instance = plainToInstance(dtoClass, payload, {
      enableImplicitConversion: true,
    });
    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      const messages = errors
        .map((error) => Object.values(error.constraints ?? {}))
        .flat()
        .join(', ');

      throw new BadRequestException(messages || 'Validation failed');
    }

    return instance;
  }
}
