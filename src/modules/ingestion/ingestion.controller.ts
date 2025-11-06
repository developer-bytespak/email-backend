import { Controller, Post, Get, UploadedFile, UseInterceptors, Body, UseGuards, Request, Param, Query, ParseIntPipe, NotFoundException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
  @Get('contacts/all')
  async getAllClientContacts(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('valid') valid?: string,
  ) {
    const clientId = req.user.id;
    
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    
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
}
