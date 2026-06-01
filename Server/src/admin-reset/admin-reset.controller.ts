import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsOptional } from 'class-validator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AdminResetService } from './admin-reset.service';

/**
 * This destructive "clean slate" action is restricted to a single operator,
 * beyond the super_admin role check. Update these if the owner changes.
 */
const ALLOWED_RESET_EMAIL = 'attrexx@gmail.com';
const ALLOWED_RESET_USER_ID = '850281e6-e321-48ad-a18e-f31df765867e';

class ResetTestDataDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

@Controller('admin/reset')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AdminResetController {
  constructor(
    private readonly reset: AdminResetService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * POST /api/admin/reset/event/:eventId/test-data
   *
   * Body: { dryRun?: boolean, confirm?: boolean }
   *  - dryRun (default true): return counts without deleting.
   *  - dryRun:false + confirm:true: actually perform the reset.
   *
   * Gated to a single owner identity on top of the super_admin role.
   */
  @Post('event/:eventId/test-data')
  @Roles('super_admin')
  async resetEventTestData(
    @Param('eventId') eventId: string,
    @Body() dto: ResetTestDataDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const allowed = user?.email === ALLOWED_RESET_EMAIL || user?.sub === ALLOWED_RESET_USER_ID;
    if (!allowed) {
      throw new ForbiddenException('This action is restricted to the system owner.');
    }

    // Default to a dry run unless the caller explicitly opts out.
    const dryRun = dto.dryRun !== false;
    if (!dryRun && dto.confirm !== true) {
      throw new BadRequestException('Confirmation is required to execute the reset.');
    }

    const result = await this.reset.resetEventData(eventId, { dryRun });

    if (!dryRun) {
      await this.audit.log({
        eventId,
        userId: user.sub,
        action: 'admin.reset_test_data',
        entity: 'event',
        entityId: eventId,
        detail: { email: user.email, counts: result.counts },
      });
    }

    return result;
  }
}
