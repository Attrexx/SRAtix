import { IsString, IsOptional, MaxLength } from 'class-validator';

export class AdminUpdateBoothDetailsDto {
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
}
