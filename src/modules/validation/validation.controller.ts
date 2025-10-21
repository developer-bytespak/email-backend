import { Controller, Post, Param, Get } from '@nestjs/common';
import { ValidationService } from './validation.service';

@Controller('validation')
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  /**
   * Validate all contacts in a CSV upload
   * POST /validation/upload/:uploadId
   */
  @Post('upload/:uploadId')
  async validateUpload(@Param('uploadId') uploadId: string) {
    const result = await this.validationService.validateUpload(
      parseInt(uploadId),
    );
    return {
      message: 'Validation completed',
      ...result,
    };
  }

  /**
   * Validate a single contact
   * POST /validation/contact/:contactId
   */
  @Post('contact/:contactId')
  async validateContact(@Param('contactId') contactId: string) {
    const isValid = await this.validationService.validateContact(
      parseInt(contactId),
    );
    return {
      message: 'Contact validated',
      valid: isValid,
    };
  }

  /**
   * Re-validate previously invalid contacts
   * POST /validation/revalidate/:uploadId
   */
  @Post('revalidate/:uploadId')
  async revalidateInvalid(@Param('uploadId') uploadId: string) {
    const count = await this.validationService.revalidateInvalid(
      parseInt(uploadId),
    );
    return {
      message: 'Revalidation completed',
      revalidatedCount: count,
    };
  }
}

