import { Controller, Post, Body, Get, Param, Put } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';

@Controller('collaboration')
export class CollaborationController {
  constructor(private readonly collaborationService: CollaborationService) {}

  @Post('draft/review')
  async requestDraftReview(@Body() reviewData: any) {
    return this.collaborationService.requestDraftReview(reviewData);
  }

  @Put('draft/:id/approve')
  async approveDraft(@Param('id') id: string) {
    return this.collaborationService.approveDraft(id);
  }

  @Get('drafts/pending')
  async getPendingDrafts() {
    return this.collaborationService.getPendingDrafts();
  }
}
