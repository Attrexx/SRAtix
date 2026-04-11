import { Module } from '@nestjs/common';
import { CompEntriesService } from './comp-entries.service';
import { CompEntriesController } from './comp-entries.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { EmailModule } from '../email/email.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TicketsModule, EmailModule, SettingsModule],
  controllers: [CompEntriesController],
  providers: [CompEntriesService],
  exports: [CompEntriesService],
})
export class CompEntriesModule {}
