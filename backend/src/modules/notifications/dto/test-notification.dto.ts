import { IsOptional, IsString, Length } from 'class-validator';

export class SendTestNotificationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  body?: string;
}
