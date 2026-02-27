import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { StripeKeyRotatorService } from '../payments/stripe-key-rotator.service';
import { IsString, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class SettingUpdateItem {
  @IsString()
  key!: string;

  @IsString()
  @IsOptional()
  value!: string;
}

class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingUpdateItem)
  settings!: SettingUpdateItem[];
}

@Controller('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly stripeKeyRotator: StripeKeyRotatorService,
  ) {}

  /**
   * GET /api/settings
   * Returns all settings with their current values (sensitive values masked).
   * Super Admin only.
   */
  @Get()
  @Roles('super_admin')
  async getAll() {
    const settings = await this.settingsService.getAll();
    const definitions = this.settingsService.getDefinitions();

    // Group by category for UI
    const groups: Record<string, typeof settings> = {};
    for (const s of settings) {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push(s);
    }

    return { settings, groups };
  }

  /**
   * PATCH /api/settings
   * Update one or more settings.
   * Super Admin only.
   */
  @Patch()
  @Roles('super_admin')
  async update(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.update(dto.settings);
  }

  /**
   * POST /api/settings/rotate-stripe-keys
   * Sets the key timestamps to now and triggers an immediate rotation.
   * Super Admin only.
   */
  @Post('rotate-stripe-keys')
  @Roles('super_admin')
  async rotateStripeKeys() {
    const now = new Date().toISOString();

    // Set both timestamps to now — forces the rotator to treat keys as fresh
    // AFTER rotation completes. The rotator checks age and rotates if ≥ 5 days.
    // To force immediate rotation, we set timestamps far in the past.
    const past = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    await this.settingsService.set('stripe_test_key_created_at', past);
    await this.settingsService.set('stripe_live_key_created_at', past);
    await this.settingsService.set('stripe_key_rotation_enabled', 'true');

    // Trigger the cron handler directly
    await this.stripeKeyRotator.handleScheduledRotation();

    return {
      triggered: true,
      message: 'Stripe key rotation triggered. Check notification emails for results.',
    };
  }
}
