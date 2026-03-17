import {
  IsString,
  IsOptional,
  MaxLength,
  IsUrl,
  IsEmail,
  IsObject,
} from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MaxLength(255)
  companyName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Website must be a valid URL' })
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}
