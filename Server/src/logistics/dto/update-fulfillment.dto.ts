import { IsString, IsIn, IsOptional, MaxLength } from 'class-validator';

export class UpdateFulfillmentDto {
  @IsString()
  @IsIn(['pending', 'fulfilled', 'problematic'])
  fulfillmentStatus!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
