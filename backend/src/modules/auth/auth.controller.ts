import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { PhoneDto, VerifyPhoneOtpDto } from './dto/phone.dto';

import { SignUpDto } from './dto/signup.dto';
import { SignInDto } from './dto/signin.dto';
import { DriverSignInDto } from './dto/driver-signin.dto';
import { FacilitySignInDto, StaffSignInDto } from './dto/facility-signin.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto.email, dto.password, dto.fullName, dto.phone);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-email-otp')
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.emailVerification.verifyEmailOtp(dto.email, dto.otp);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('resend-email-otp')
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.emailVerification.resendVerificationOtp(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('signin')
  signIn(@Body() dto: SignInDto) {
    return this.auth.signIn(dto.email, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('driver/signin')
  driverSignIn(@Body() dto: DriverSignInDto) {
    return this.auth.driverSignIn(dto.phone, dto.pin);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('facility/signin')
  facilitySignIn(@Body() dto: FacilitySignInDto) {
    return this.auth.facilitySignIn(dto.phone, dto.pin);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('staff/signin')
  staffSignIn(@Body() dto: StaffSignInDto) {
    return this.auth.staffSignIn(dto.phone, dto.pin);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.requestResetOtp(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-reset-otp')
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordReset.verifyResetOtp(dto.email, dto.otp);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Req() request: any, @Body() dto: ResetPasswordDto) {
    const authHeader = request.headers?.authorization || '';
    const headerToken = authHeader.replace(/^Bearer\s+/i, '');
    const resetToken = dto.resetToken || headerToken;
    const password = dto.newPassword || dto.password;
    return this.passwordReset.resetPassword(resetToken, password, dto.confirmPassword);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('phone/request-otp')
  request(@Body() dto: PhoneDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('phone/verify-otp')
  verify(@Body() dto: VerifyPhoneOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshSessionDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Get('realtime-config')
  getRealtimeConfig() {
    return this.auth.getRealtimeConfig();
  }

  @Get('me')
  me(@Req() request: any) {
    return this.auth.me(request.user.id);
  }
}
