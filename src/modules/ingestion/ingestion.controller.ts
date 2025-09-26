import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { UploadCsvResponseDto } from './dto/upload-csv.dto';
import { MapColumnsDto, MapColumnsResponseDto } from './dto/column-mapping.dto';
import {
  ProcessingStatusDto,
  ProcessingResultDto,
  ProcessCsvResponseDto,
} from './dto/processing-result.dto';

@Controller('api/ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('upload-csv')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async uploadCsv(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { clientId: number },
  ): Promise<UploadCsvResponseDto> {
    return this.ingestionService.uploadCsv(file, body.clientId);
  }

  @Post(':uploadId/map-columns')
  @HttpCode(HttpStatus.OK)
  async mapColumns(
    @Param('uploadId', ParseIntPipe) uploadId: number,
    @Body() mapColumnsDto: MapColumnsDto,
  ): Promise<MapColumnsResponseDto> {
    return this.ingestionService.mapColumns(uploadId, mapColumnsDto.mapping);
  }

  @Post(':uploadId/process')
  @HttpCode(HttpStatus.OK)
  async processCsv(
    @Param('uploadId', ParseIntPipe) uploadId: number,
  ): Promise<ProcessCsvResponseDto> {
    return this.ingestionService.processCsv(uploadId);
  }

  @Get(':uploadId/status')
  async getProcessingStatus(
    @Param('uploadId', ParseIntPipe) uploadId: number,
  ): Promise<ProcessingStatusDto> {
    return this.ingestionService.getProcessingStatus(uploadId);
  }

  @Get(':uploadId/results')
  async getProcessingResults(
    @Param('uploadId', ParseIntPipe) uploadId: number,
  ): Promise<ProcessingResultDto> {
    return this.ingestionService.getProcessingResults(uploadId);
  }

  @Post('create-client')
  @HttpCode(HttpStatus.CREATED)
  async createClient(@Body() clientData: any) {
    return this.ingestionService.createClient(clientData);
  }
}
