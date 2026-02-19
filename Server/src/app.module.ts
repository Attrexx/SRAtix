import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { OrdersModule } from './orders/orders.module';
import { AttendeesModule } from './attendees/attendees.module';
import { HealthModule } from './health/health.module';
import { PaymentsModule } from './payments/payments.module';
import { SseModule } from './sse/sse.module';
import { TicketsModule } from './tickets/tickets.module';
import { CheckInsModule } from './check-ins/check-ins.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { EmailModule } from './email/email.module';
import { FormsModule } from './forms/forms.module';
import { PromoCodesModule } from './promo-codes/promo-codes.module';
import { InvoicesModule } from './invoices/invoices.module';
import { GdprModule } from './gdpr/gdpr.module';
import { ExportModule } from './export/export.module';
import { QueueModule } from './queue/queue.module';
import { BadgeTemplatesModule } from './badge-templates/badge-templates.module';
import { OutgoingWebhooksModule } from './outgoing-webhooks/outgoing-webhooks.module';
import { UsersModule } from './users/users.module';
import { join } from 'path';

@Module({
  imports: [
    // Config — loads .env from Server/ dir (CWD on Infomaniak is repo root)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(__dirname, '..', '.env'),  // Server/.env (relative to dist/)
        '.env',                          // fallback: CWD
      ],
    }),

    // Database
    PrismaModule,

    // Global modules (available everywhere without explicit import)
    AuditLogModule,

    // Core modules — Phase 1
    AuthModule,
    HealthModule,
    EventsModule,
    TicketTypesModule,
    OrdersModule,
    AttendeesModule,

    // Tickets — issuance, QR codes, management
    TicketsModule,

    // Check-ins — QR validation, recording, offline sync
    CheckInsModule,

    // Payments — Stripe Checkout
    PaymentsModule,

    // Email — SMTP transport, templates
    EmailModule,

    // Registration form engine — versioned schemas & submissions
    FormsModule,

    // Promo/discount codes
    PromoCodesModule,

    // Invoices — PDF generation
    InvoicesModule,

    // GDPR/nLPD — erasure, access, consent tracking
    GdprModule,

    // Data export — CSV downloads
    ExportModule,

    // Real-time — Server-Sent Events
    SseModule,

    // Phase 2 — Background job queues (BullMQ + Redis)
    QueueModule,

    // Phase 2 — Badge template rendering (satori pipeline)
    BadgeTemplatesModule,

    // Phase 2 — Outgoing webhook endpoints + dispatch
    OutgoingWebhooksModule,

    // User management (app-native accounts, Super Admin CRUD)
    UsersModule,
  ],
})
export class AppModule {}
