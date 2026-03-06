import { IsNumber, Min } from 'class-validator';

export class DeleteCsvDto {
  @IsNumber()
  @Min(1)
  csvId: number;
}

export class DeleteCsvResponseDto {
  success: boolean;
  message: string;
  csvId: number;
  deletedStats: {
    contacts: number;
    emailDrafts: number;
    emailLogs: number;
    smsDrafts: number;
    smsLogs: number;
    summaries: number;
    scrapedData: number;
    emailEngagements: number;
    emailQueues: number;
  };
}
