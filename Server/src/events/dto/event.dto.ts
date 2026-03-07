import {
  IsString,
  IsDateString,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  MinLength,
  Allow,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  slug!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  @MaxLength(50)
  timezone!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  venue?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsString()
  @MaxLength(3)
  currency!: string;
}

export class UpdateEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @IsOptional()
  slug?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsDateString()
  @IsOptional()
  doorsOpen?: string | null;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  venue?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  venueAddress?: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  description?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  timezone?: string;

  @IsString()
  @MaxLength(3)
  @IsOptional()
  currency?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxCapacity?: number | null;

  @IsString()
  @IsOptional()
  status?: string;

  @Allow()
  @IsOptional()
  meta?: Record<string, unknown>;
}
