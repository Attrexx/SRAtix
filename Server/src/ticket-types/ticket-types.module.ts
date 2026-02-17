import { Module } from '@nestjs/common';
import { TicketTypesService } from './ticket-types.service';
import { TicketTypesController } from './ticket-types.controller';
import { TicketTypesPublicController } from './ticket-types-public.controller';

@Module({
  controllers: [TicketTypesController, TicketTypesPublicController],
  providers: [TicketTypesService],
  exports: [TicketTypesService],
})
export class TicketTypesModule {}
