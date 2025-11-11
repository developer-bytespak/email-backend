import { IsDateString, IsOptional } from 'class-validator';

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
}


