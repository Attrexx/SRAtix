import { IsString, IsNotEmpty, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class LogisticsCheckoutItemDto {
  @IsString()
  @IsNotEmpty()
  logisticsItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class LogisticsCheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LogisticsCheckoutItemDto)
  items!: LogisticsCheckoutItemDto[];

  @IsString()
  @IsNotEmpty()
  successUrl!: string;

  @IsString()
  @IsNotEmpty()
  cancelUrl!: string;
}
