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

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto.email, dto.password, dto.fullName, dto.phone);
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
    return this.auth.forgotPassword(dto.email, dto.redirectTo);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Req() request: any, @Body() dto: ResetPasswordDto) {
    const authHeader = request.headers?.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    return this.auth.resetPassword(token, dto.password);
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

  @Get('me')
  me(@Req() request: any) {
    return this.auth.me(request.user.id);
  }
}
