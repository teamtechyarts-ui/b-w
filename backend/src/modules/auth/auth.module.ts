import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [SupabaseModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, EmailVerificationService],
  exports: [AuthService, PasswordResetService, EmailVerificationService],
})
export class AuthModule {}
