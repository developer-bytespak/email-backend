import { Controller, Post, Param, Get, Body, UseGuards } from '@nestjs/common';
import { ValidationService } from './validation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('validation')
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  /**
   * Validate email address in real-time
   * POST /validation/email
   * Must come before parameterized routes to avoid route conflicts
   */
  @UseGuards(JwtAuthGuard)
  @Post('email')
  async validateEmail(@Body('email') email: string) {
    if (!email || typeof email !== 'string') {
      return {
        valid: false,
        error: 'Email address is required',
      };
    }
    const isValid = await this.validationService.validateEmail(email);
    return {
      valid: isValid,
      message: isValid ? 'Email is valid and reachable' : 'Email is invalid or unreachable',
    };
  }

  /**
   * Validate website URL in real-time
   * POST /validation/website
   * Must come before parameterized routes to avoid route conflicts
   */
  @UseGuards(JwtAuthGuard)
  @Post('website')
  async validateWebsite(@Body('website') website: string) {
    if (!website || typeof website !== 'string') {
      return {
        valid: false,
        error: 'Website URL is required',
      };
    }
    const isValid = await this.validationService.validateWebsite(website);
    return {
      valid: isValid,
      message: isValid ? 'Website is reachable' : 'Website is unreachable or invalid',
    };
  }

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

