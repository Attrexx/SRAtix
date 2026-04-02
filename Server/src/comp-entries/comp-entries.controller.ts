import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { CompEntriesService, COMP_TYPES, CompType } from './comp-entries.service';
import { IsString, IsEmail, IsOptional, IsIn } from 'class-validator';

class CreateCompEntryDto {
  @IsIn(COMP_TYPES as unknown as string[])
  compType!: CompType;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  organization?: string;
}

class UpdateCompEntryDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(COMP_TYPES as unknown as string[])
  compType?: CompType;

  @IsOptional()
  @IsString()
  organization?: string;
}

@Controller('events/:eventId/comp-entries')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CompEntriesController {
  constructor(private readonly service: CompEntriesService) {}

  @Get('summary')
  @Roles('event_admin', 'admin', 'super_admin')
  summary(@Param('eventId') eventId: string) {
    return this.service.summary(eventId);
  }

  @Get()
  @Roles('event_admin', 'admin', 'super_admin')
  findAll(@Param('eventId') eventId: string) {
    return this.service.findByEventFiltered(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(eventId, id);
  }

  @Post()
  @Roles('event_admin', 'admin', 'super_admin')
  create(
    @Param('eventId') eventId: string,
    @Body() dto: CreateCompEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(eventId, dto, user.sub);
  }

  @Patch(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  update(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(eventId, id, dto, user.sub);
  }

  @Delete(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  remove(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(eventId, id, user.sub);
  }
}
