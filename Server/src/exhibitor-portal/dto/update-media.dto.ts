import { IsOptional, IsArray, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MediaItem {
  @IsUrl()
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;
}

export class UpdateMediaDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MediaItem)
  mediaGallery?: MediaItem[];

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  videoLinks?: string[];
}
