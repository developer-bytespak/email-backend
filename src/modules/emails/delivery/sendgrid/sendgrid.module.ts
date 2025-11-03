import { Module } from '@nestjs/common';
import { SendGridService } from './sendgrid.service';
import { PrismaModule } from '../../../../config/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SendGridService],
  exports: [SendGridService],
})
export class SendGridModule {}

