import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { UsersService, UserWithRoles, getHighestRoleLevel, getRoleLevel } from './users.service';
import {
  IsString,
  IsEmail,
  IsArray,
  IsOptional,
  IsBoolean,
  MinLength,
} from 'class-validator';

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsArray()
  @IsString({ each: true })
  roles!: string[];

  @IsOptional()
  @IsString()
  orgId?: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @IsOptional()
  @IsString()
  orgId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/users
   * List all users (Super Admin / Admin).
   */
  @Get()
  @Roles('super_admin', 'admin')
  async findAll(): Promise<UserWithRoles[]> {
    return this.usersService.findAll();
  }

  /**
   * GET /api/users/roles
   * Get available role definitions for the UI.
   */
  @Get('roles')
  @Roles('super_admin', 'admin')
  getRoles() {
    return this.usersService.getAvailableRoles();
  }

  /**
   * GET /api/users/stats
   * Get user statistics (Super Admin only).
   */
  @Get('stats')
  @Roles('super_admin')
  async getStats() {
    return this.usersService.getStats();
  }

  /**
   * GET /api/users/:id
   * Get a single user (Super Admin / Admin).
   */
  @Get(':id')
  @Roles('super_admin', 'admin')
  async findOne(@Param('id') id: string): Promise<UserWithRoles> {
    return this.usersService.findOne(id);
  }

  /**
   * POST /api/users
   * Create a new app user (Super Admin / Admin with hierarchy check).
   */
  @Post()
  @Roles('super_admin', 'admin')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<UserWithRoles> {
    // Hierarchy enforcement: actor cannot assign roles at or above their own level
    const actorLevel = getHighestRoleLevel(actor.roles);
    const hasDisallowed = dto.roles.some((r) => getRoleLevel(r) <= actorLevel);
    if (hasDisallowed) {
      throw new ForbiddenException('Cannot assign roles at or above your own level');
    }
    return this.usersService.create({
      email: dto.email,
      displayName: dto.displayName,
      password: dto.password,
      roles: dto.roles,
      orgId: dto.orgId,
    });
  }

  /**
   * PATCH /api/users/:id
   * Update a user (Super Admin / Admin with hierarchy check).
   */
  @Patch(':id')
  @Roles('super_admin', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<UserWithRoles> {
    const actorLevel = getHighestRoleLevel(actor.roles);
    // Check target user's current rank
    const target = await this.usersService.findOne(id);
    if (getHighestRoleLevel(target.roles) <= actorLevel) {
      throw new ForbiddenException('Cannot modify a user at or above your own level');
    }
    // Check new roles if provided
    if (dto.roles) {
      const hasDisallowed = dto.roles.some((r) => getRoleLevel(r) <= actorLevel);
      if (hasDisallowed) {
        throw new ForbiddenException('Cannot assign roles at or above your own level');
      }
    }
    return this.usersService.update(id, dto);
  }

  /**
   * DELETE /api/users/:id
   * Deactivate a user — soft delete (Super Admin / Admin with hierarchy check).
   */
  @Delete(':id')
  @Roles('super_admin', 'admin')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    const actorLevel = getHighestRoleLevel(actor.roles);
    const target = await this.usersService.findOne(id);
    if (getHighestRoleLevel(target.roles) <= actorLevel) {
      throw new ForbiddenException('Cannot deactivate a user at or above your own level');
    }
    return this.usersService.deactivate(id);
  }

  /**
   * POST /api/users/:id/activate
   * Re-activate a deactivated user (Super Admin / Admin with hierarchy check).
   */
  @Post(':id/activate')
  @Roles('super_admin', 'admin')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    const actorLevel = getHighestRoleLevel(actor.roles);
    const target = await this.usersService.findOne(id);
    if (getHighestRoleLevel(target.roles) <= actorLevel) {
      throw new ForbiddenException('Cannot activate a user at or above your own level');
    }
    return this.usersService.activate(id);
  }
}
