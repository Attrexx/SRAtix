import { IsInt, Min } from 'class-validator';

export class FulfillItemDto {
  @IsInt()
  @Min(0)
  quantity!: number;
}
