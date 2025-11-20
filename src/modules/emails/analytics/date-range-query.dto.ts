import { IsDateString, IsOptional, IsEmail } from 'class-validator';

export class DateRangeQueryDto {
  /**
   * Inclusive start of the reporting window (ISO 8601 string).
   * Defaults to 14 days before `to` when omitted.
   */
  @IsOptional()
  @IsDateString()
  from?: string;

  /**
   * Inclusive end of the reporting window (ISO 8601 string).
   * Defaults to the current date/time when omitted.
   */
  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Filter by sender email address (from ClientEmail.emailAddress).
   * Optional - if omitted, returns analytics for all sender emails.
   */
  @IsOptional()
  @IsEmail()
  fromEmail?: string;
}


