import { IsString, IsOptional, IsInt, MaxLength, Min } from 'class-validator';

export class CreateLogisticsItemDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsInt()
  @Min(0)
  stockTotal!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
