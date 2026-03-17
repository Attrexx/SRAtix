import { IsObject, IsOptional, IsIn, IsString, MaxLength } from 'class-validator';

export class UpsertSetupRequestDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsIn(['draft', 'submitted'])
  status?: string;
}

export class AdminUpdateSetupRequestDto {
  @IsOptional()
  @IsIn(['confirmed', 'modification_requested'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  adminNotes?: string;
}
