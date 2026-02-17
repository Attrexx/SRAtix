import { Module, Global } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * AuditLog Module — marked Global so any module can inject AuditLogService
 * without explicit imports.
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
