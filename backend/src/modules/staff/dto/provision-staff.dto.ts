import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class ProvisionStaffDto {
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string;

  @IsIn(['driver', 'facility_employee', 'manager'])
  role!: 'driver' | 'facility_employee' | 'manager';

  @IsOptional()
  @IsUUID()
  facilityId?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Driver PIN must be exactly 6 digits' })
  pin?: string;
}
