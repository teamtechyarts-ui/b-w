import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ClaimJobDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['pickup', 'delivery'])
  jobType!: 'pickup' | 'delivery';
}
