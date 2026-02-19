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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService, UserWithRoles } from './users.service';
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
   * List all users (Super Admin only).
   */
  @Get()
  @Roles('super_admin')
  async findAll(): Promise<UserWithRoles[]> {
    return this.usersService.findAll();
  }

  /**
   * GET /api/users/roles
   * Get available role definitions for the UI.
   */
  @Get('roles')
  @Roles('super_admin')
  getRoles() {
    return this.usersService.getAvailableRoles();
  }

  /**
   * GET /api/users/:id
   * Get a single user (Super Admin only).
   */
  @Get(':id')
  @Roles('super_admin')
  async findOne(@Param('id') id: string): Promise<UserWithRoles> {
    return this.usersService.findOne(id);
  }

  /**
   * POST /api/users
   * Create a new app user (Super Admin only).
   */
  @Post()
  @Roles('super_admin')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto): Promise<UserWithRoles> {
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
   * Update a user (Super Admin only).
   */
  @Patch(':id')
  @Roles('super_admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserWithRoles> {
    return this.usersService.update(id, dto);
  }

  /**
   * DELETE /api/users/:id
   * Deactivate a user — soft delete (Super Admin only).
   */
  @Delete(':id')
  @Roles('super_admin')
  async deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }

  /**
   * POST /api/users/:id/activate
   * Re-activate a deactivated user (Super Admin only).
   */
  @Post(':id/activate')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async activate(@Param('id') id: string) {
    return this.usersService.activate(id);
  }
}
