import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';
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
  constructor(private readonly settingsService: SettingsService) {}

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
}
