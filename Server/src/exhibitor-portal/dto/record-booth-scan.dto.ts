import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';

export class RecordBoothScanDto {
  @IsString()
  @MaxLength(36)
  eventExhibitorId!: string;

  @IsString()
  @MaxLength(16)
  hmac!: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  attendeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
