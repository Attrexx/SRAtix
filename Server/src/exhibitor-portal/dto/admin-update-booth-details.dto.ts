import { IsString, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';

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

  /**
   * Per-booth included staff seats (overrides the ticket-type maxStaff for this
   * exhibitor). Stored on EventExhibitor.meta.includedSeats. 0 = no included
   * staff seats; omit to leave unchanged.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  includedSeats?: number;
}
