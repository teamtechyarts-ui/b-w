import { IsString, Matches } from 'class-validator';

export class FacilitySignInDto {
  @IsString({ message: 'Phone number is required' })
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone number must be a valid E.164 number (e.g. +919876543210)' })
  phone!: string;

  @IsString({ message: 'PIN is required' })
  @Matches(/^\d{6}$/, { message: 'Facility Employee PIN must be exactly 6 digits' })
  pin!: string;
}

export class StaffSignInDto {
  @IsString({ message: 'Phone number is required' })
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone number must be a valid E.164 number (e.g. +919876543210)' })
  phone!: string;

  @IsString({ message: 'PIN is required' })
  @Matches(/^\d{6}$/, { message: 'PIN must be exactly 6 digits' })
  pin!: string;
}
