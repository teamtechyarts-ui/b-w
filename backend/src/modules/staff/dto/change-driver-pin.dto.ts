import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export class ChangeDriverPinDto {
  @ValidateIf(o => !o.newPin)
  @IsString({ message: 'Driver PIN is required' })
  @Matches(/^\d{6}$/, { message: 'Driver PIN must be exactly 6 digits' })
  pin?: string;

  @ValidateIf(o => !o.pin)
  @IsString({ message: 'New Driver PIN is required' })
  @Matches(/^\d{6}$/, { message: 'New Driver PIN must be exactly 6 digits' })
  newPin?: string;

  @IsOptional()
  @IsString()
  confirmPin?: string;

  get resolvedPin(): string {
    return (this.newPin || this.pin || '').trim();
  }
}
