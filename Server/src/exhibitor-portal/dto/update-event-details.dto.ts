import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateEventDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  boothNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  expoArea?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  exhibitorCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  exhibitorType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  demoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  demoDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;
}
