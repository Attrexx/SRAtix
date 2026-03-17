import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';

export class RecordBoothLeadDto {
  @IsString()
  @MaxLength(36)
  eventExhibitorId!: string;

  @IsString()
  @MaxLength(16)
  hmac!: string;

  @IsString()
  @MaxLength(36)
  attendeeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
