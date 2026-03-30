import { IsString, MaxLength } from 'class-validator';

export class UpdateOrderNotesDto {
  @IsString()
  @MaxLength(1000)
  notes!: string;
}
