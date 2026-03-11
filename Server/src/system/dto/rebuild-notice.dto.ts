import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RebuildNoticeDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}
