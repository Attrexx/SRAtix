import { IsString, IsOptional, IsEmail, MaxLength, IsIn } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsIn(['booth_manager', 'staff', 'demo_presenter'])
  role?: string;
}
