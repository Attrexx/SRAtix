import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { OrdersModule } from './orders/orders.module';
import { AttendeesModule } from './attendees/attendees.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Config — loads .env, validates required vars
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database
    PrismaModule,

    // Core modules — Phase 1
    AuthModule,
    HealthModule,
    EventsModule,
    TicketTypesModule,
    OrdersModule,
    AttendeesModule,
  ],
})
export class AppModule {}
