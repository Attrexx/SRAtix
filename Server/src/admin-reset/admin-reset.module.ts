import { Module } from '@nestjs/common';
import { AdminResetController } from './admin-reset.controller';
import { AdminResetService } from './admin-reset.service';

/**
 * Admin Reset — owner-only "clean slate before go-live" data wipe.
 * PrismaService and AuditLogService are provided by global modules.
 */
@Module({
  controllers: [AdminResetController],
  providers: [AdminResetService],
})
export class AdminResetModule {}
