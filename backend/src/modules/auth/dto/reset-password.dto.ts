import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsOptional()
  @IsString({ message: 'Reset token must be a string' })
  resetToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  newPassword?: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;

  // Preserved for backward compatibility with existing tests and callers
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;
}
