import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './config/prisma.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { ValidationModule } from './modules/validation/validation.module';

@Module({
  imports: [
    PrismaModule,
    IngestionModule,
    ValidationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
