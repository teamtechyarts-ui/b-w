import { BadRequestException, forwardRef, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { EmailVerificationService } from './email-verification.service';
import {
  getDriverInternalEmail,
  getFacilityEmployeeInternalEmail,
  getStaffInternalEmail,
  verifyDriverPin,
} from './driver-pin.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly s: SupabaseService,
    @Optional() private readonly config?: ConfigService,
    @Optional()
    @Inject(forwardRef(() => EmailVerificationService))
    private readonly emailVerification?: EmailVerificationService,
  ) {}

  async driverSignIn(phone: string, pin: string) {
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone) || !pin || !/^\d{6}$/.test(pin)) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    const db = this.s.admin;

    // 1. Locate driver profile
    const { data: profile, error: profileErr } = await db
      .from('profiles')
      .select('id, full_name, phone, is_active')
      .eq('phone', phone)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 2. Validate role is driver
    const { data: roles, error: rolesErr } = await db
      .from('profile_roles')
      .select('roles(code)')
      .eq('profile_id', profile.id);

    if (rolesErr || !(roles ?? []).some((r: any) => r.roles?.code === 'driver')) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 3. Validate driver operational record is active
    let driverPinHashFromDb: string | null = null;
    try {
      const { data: driver, error: driverErr } = await db
        .from('drivers')
        .select('id, is_active, driver_pin_hash')
        .eq('profile_id', profile.id)
        .maybeSingle();

      if (driverErr || !driver || !driver.is_active) {
        throw new UnauthorizedException('Invalid phone number or PIN.');
      }
      driverPinHashFromDb = driver.driver_pin_hash || null;
    } catch {
      // If driver_pin_hash column is not present on table yet
      const { data: driverFallback, error: fallbackErr } = await db
        .from('drivers')
        .select('id, is_active')
        .eq('profile_id', profile.id)
        .maybeSingle();

      if (fallbackErr || !driverFallback || !driverFallback.is_active) {
        throw new UnauthorizedException('Invalid phone number or PIN.');
      }
    }

    // 4. Validate PIN hash against driver record or Supabase Auth app_metadata
    let pinVerified = false;
    if (driverPinHashFromDb) {
      pinVerified = verifyDriverPin(pin, driverPinHashFromDb);
    }

    const { data: authUser } = await db.auth.admin.getUserById(profile.id);
    if (!pinVerified && authUser?.user?.app_metadata?.driver_pin_hash) {
      pinVerified = verifyDriverPin(pin, authUser.user.app_metadata.driver_pin_hash);
    }
    if (!pinVerified && authUser?.user?.app_metadata?.employee_pin_hash) {
      pinVerified = verifyDriverPin(pin, authUser.user.app_metadata.employee_pin_hash);
    }
    if (!pinVerified && authUser?.user?.app_metadata?.pin_hash) {
      pinVerified = verifyDriverPin(pin, authUser.user.app_metadata.pin_hash);
    }

    if (!pinVerified) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 5. Establish authenticated Supabase session using deterministic internal email
    const internalEmail = getDriverInternalEmail(phone);
    let signInResult = await this.s.createAuthClient().auth.signInWithPassword({
      email: internalEmail,
      password: pin,
    });

    if (signInResult.error || !signInResult.data?.session) {
      // Synchronize internal credentials if needed
      await db.auth.admin.updateUserById(profile.id, {
        email: internalEmail,
        email_confirm: true,
        password: pin,
      });

      signInResult = await this.s.createAuthClient().auth.signInWithPassword({
        email: internalEmail,
        password: pin,
      });
    }

    if (signInResult.error || !signInResult.data?.session || !signInResult.data?.user) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 6. Ensure profile and resolve driver role
    const ensuredProfile = await this.ensureProfile(
      signInResult.data.user.id,
      profile.phone || phone,
      profile.full_name,
    );

    return {
      session: signInResult.data.session,
      user: {
        id: signInResult.data.user.id,
        phone: profile.phone || phone,
        email: null,
      },
      profile: ensuredProfile,
    };
  }

  async facilitySignIn(phone: string, pin: string) {
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone) || !pin || !/^\d{6}$/.test(pin)) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    const db = this.s.admin;

    // 1. Locate facility employee profile
    const { data: profile, error: profileErr } = await db
      .from('profiles')
      .select('id, full_name, phone, is_active')
      .eq('phone', phone)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 2. Validate role is facility_employee
    const { data: roles, error: rolesErr } = await db
      .from('profile_roles')
      .select('roles(code)')
      .eq('profile_id', profile.id);

    const hasFacilityRole = (roles ?? []).some((r: any) => r.roles?.code === 'facility_employee');
    if (rolesErr || !hasFacilityRole) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 3. Validate facility operational record and active facility
    const { data: employee, error: empErr } = await db
      .from('facility_employees')
      .select('id, facility_id, is_active, employee_role')
      .eq('profile_id', profile.id)
      .maybeSingle();

    if (empErr || !employee || !employee.is_active || !employee.facility_id) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    const { data: facility, error: facErr } = await db
      .from('facilities')
      .select('id, name, address, is_active')
      .eq('id', employee.facility_id)
      .maybeSingle();

    if (facErr || !facility || !facility.is_active) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 4. Validate PIN hash
    let pinVerified = false;
    const { data: authUser } = await db.auth.admin.getUserById(profile.id);
    const storedHash = authUser?.user?.app_metadata?.employee_pin_hash ||
      authUser?.user?.app_metadata?.driver_pin_hash ||
      authUser?.user?.app_metadata?.pin_hash;

    if (storedHash) {
      pinVerified = verifyDriverPin(pin, storedHash);
    }

    if (!pinVerified) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 5. Establish authenticated Supabase session using deterministic internal email
    const internalEmail = getFacilityEmployeeInternalEmail(phone);
    let signInResult = await this.s.createAuthClient().auth.signInWithPassword({
      email: internalEmail,
      password: pin,
    });

    if (signInResult.error || !signInResult.data?.session) {
      // Synchronize internal credentials if needed
      await db.auth.admin.updateUserById(profile.id, {
        email: internalEmail,
        email_confirm: true,
        password: pin,
      });

      signInResult = await this.s.createAuthClient().auth.signInWithPassword({
        email: internalEmail,
        password: pin,
      });
    }

    if (signInResult.error || !signInResult.data?.session || !signInResult.data?.user) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    // 6. Ensure profile
    const ensuredProfile = await this.ensureProfile(
      signInResult.data.user.id,
      profile.phone || phone,
      profile.full_name,
    );

    return {
      session: signInResult.data.session,
      user: {
        id: signInResult.data.user.id,
        phone: profile.phone || phone,
        email: null,
      },
      profile: ensuredProfile,
      facility: {
        id: facility.id,
        name: facility.name,
      },
    };
  }

  async staffSignIn(phone: string, pin: string) {
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone) || !pin || !/^\d{6}$/.test(pin)) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    const db = this.s.admin;
    const { data: profile } = await db
      .from('profiles')
      .select('id, is_active')
      .eq('phone', phone)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      throw new UnauthorizedException('Invalid phone number or PIN.');
    }

    const { data: roles } = await db
      .from('profile_roles')
      .select('roles(code)')
      .eq('profile_id', profile.id);

    const codes = (roles ?? []).map((r: any) => r.roles?.code);
    if (codes.includes('driver')) {
      return this.driverSignIn(phone, pin);
    }
    if (codes.includes('facility_employee')) {
      return this.facilitySignIn(phone, pin);
    }

    throw new UnauthorizedException('Invalid phone number or PIN.');
  }

  async requestOtp(phone: string) {
    const { error } = await this.s.createAuthClient().auth.signInWithOtp({
      phone, options: { shouldCreateUser: true },
    });
    if (error) throw new BadRequestException(error.message);
    return { sent: true };
  }

  async verifyOtp(phone: string, token: string) {
    // OTP verification stores a session in memory, so never share this client.
    const { data, error } = await this.s.createAuthClient().auth.verifyOtp({ phone, token, type: 'sms' });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException(error?.message || 'Invalid OTP');
    }
    const profile = await this.ensureProfile(data.user.id, data.user.phone);
    return { session: data.session, user: { id: data.user.id, phone: data.user.phone }, profile };
  }

  async refresh(refreshToken: string) {
    // Refreshing rotates session credentials, so isolate the auth state per request.
    const { data, error } = await this.s.createAuthClient().auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session || !data.user) {
      // Provider errors may contain credential-related context. Keep the public
      // response stable and never include the submitted refresh token.
      throw new UnauthorizedException('Invalid or expired refresh session');
    }

    const profile = await this.ensureProfile(data.user.id, data.user.phone);
    return {
      session: data.session,
      user: { id: data.user.id, phone: data.user.phone },
      profile,
    };
  }

  async signUp(email: string, password: string, fullName: string, phone?: string) {
    const cleanEmail = email.trim().toLowerCase();
    let userId: string;

    // In production with Supabase Admin API, create user unverified (email_confirm: false)
    // so GoTrue does NOT send email confirmation links
    if (this.s.admin?.auth?.admin?.createUser) {
      const { data: createData, error: createError } = await this.s.admin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: false,
        user_metadata: {
          full_name: fullName,
          ...(phone ? { phone } : {}),
        },
      });

      if (createError) {
        const msg = createError.message?.toLowerCase() || '';
        if (msg.includes('already registered') || msg.includes('user already exists')) {
          // Check if existing user is unverified - if so, allow verification retry without duplicate error
          let existingUser: any = null;
          try {
            const { data: linkData } = await this.s.admin.auth.admin.generateLink({
              type: 'recovery',
              email: cleanEmail,
            });
            existingUser = linkData?.user;
          } catch {
            // Ignore error
          }

          if (existingUser && !existingUser.email_confirmed_at) {
            if (this.emailVerification) {
              await this.emailVerification.issueAndSendVerificationOtp(existingUser.id, cleanEmail);
            }
            return {
              session: null,
              user: { id: existingUser.id, email: cleanEmail, phone: phone || null },
              profile: null,
              requiresEmailConfirmation: true,
              message: 'A verification code has been sent to your email address.',
            };
          }
          throw new BadRequestException('An account with this email already exists.');
        }
        if (msg.includes('password')) {
          throw new BadRequestException('Password must be at least 6 characters long.');
        }
        if (msg.includes('email') || msg.includes('invalid format')) {
          throw new BadRequestException('Please enter a valid email address.');
        }
        throw new BadRequestException('Unable to create your account right now. Please try again.');
      }

      userId = createData.user.id;
    } else {
      // Fallback for mocked unit tests where admin.createUser is not stubbed
      const { data, error } = await this.s.createAuthClient().auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: fullName,
            ...(phone ? { phone } : {}),
          },
        },
      });

      if (error) {
        const msg = error.message?.toLowerCase() || '';
        if (msg.includes('already registered') || msg.includes('user already exists')) {
          throw new BadRequestException('An account with this email already exists.');
        }
        if (msg.includes('password')) {
          throw new BadRequestException('Password must be at least 6 characters long.');
        }
        if (msg.includes('email') || msg.includes('invalid format')) {
          throw new BadRequestException('Please enter a valid email address.');
        }
        throw new BadRequestException('Unable to create your account right now. Please try again.');
      }

      if (!data.user) {
        throw new BadRequestException('Unable to create your account right now. Please try again.');
      }

      userId = data.user.id;
    }

    // Issue and dispatch verification OTP via Nodemailer & Gmail SMTP
    if (this.emailVerification && userId) {
      await this.emailVerification.issueAndSendVerificationOtp(userId, cleanEmail);
    }

    return {
      session: null,
      user: { id: userId, email: cleanEmail, phone: phone || null },
      profile: null,
      requiresEmailConfirmation: true,
      message: 'Account created successfully. A verification code has been sent to your email.',
    };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.s.createAuthClient().auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      const msg = error?.message?.toLowerCase() || '';
      if (msg.includes('email not confirmed')) {
        throw new UnauthorizedException('Please verify your email before signing in.');
      }
      throw new UnauthorizedException('Invalid email or password.');
    }

    const profile = await this.ensureProfile(
      data.user.id,
      data.user.phone || (data.user.user_metadata?.phone as string | undefined),
      data.user.user_metadata?.full_name as string | undefined,
    );

    return {
      session: data.session,
      user: {
        id: data.user.id,
        email: data.user.email,
        phone: data.user.phone || (data.user.user_metadata?.phone as string | undefined) || null,
      },
      profile,
    };
  }

  async forgotPassword(email: string, redirectTo?: string) {
    try {
      const frontendUrl =
        this.config?.get<string>('FRONTEND_URL') ||
        process.env.FRONTEND_URL ||
        'http://localhost:5173';
      const targetRedirectTo =
        redirectTo || `${frontendUrl.replace(/\/$/, '')}/auth/reset-password`;

      await this.s.createAuthClient().auth.resetPasswordForEmail(email, {
        redirectTo: targetRedirectTo,
      });
    } catch {
      // Intentionally suppress specific provider failure to prevent account enumeration
    }
    return { sent: true };
  }

  async resetPassword(accessToken: string, newPassword: string) {
    if (!accessToken) {
      throw new UnauthorizedException('Missing recovery authorization token.');
    }
    const client = this.s.createUserClient(accessToken);
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      throw new BadRequestException(error.message || 'Unable to update password. Please try again.');
    }
    return { success: true };
  }

  private cachedCustomerRoleId: string | null = null;

  async ensureProfile(id: string, phone?: string, fullName?: string) {
    // Trusted provisioning is scoped exclusively to the verified Auth user.
    const db = this.s.admin;
    const { error: insertError } = await db.from('profiles').upsert(
      { id, phone: phone || null, ...(fullName ? { full_name: fullName } : {}) },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (insertError) throw new BadRequestException(insertError.message);
    const { data: profile, error } = await db.from('profiles').select('*').eq('id', id).single();
    if (error) throw new BadRequestException(error.message);
    if (!profile?.is_active) throw new UnauthorizedException('Inactive or missing profile');

    const { data: assignments, error: lookupError } = await db.from('profile_roles')
      .select('roles(code)').eq('profile_id', id);
    if (lookupError) throw new UnauthorizedException('Unable to resolve account role');
    const codes = (assignments ?? []).map((row: any) => row.roles?.code).filter(Boolean);
    const privileged = codes.filter((code: string) =>
      ['driver', 'facility_employee', 'manager', 'admin'].includes(code));
    if (privileged.length) {
      if (codes.length !== 1) throw new UnauthorizedException('Conflicting account roles');
      const role = privileged[0];
      if (role === 'driver') {
        const { data: driver, error: driverError } = await db.from('drivers')
          .select('id,is_active').eq('profile_id', id).maybeSingle();
        if (driverError || !driver?.is_active) throw new UnauthorizedException('Inactive driver account');
      } else if (role === 'manager' || role === 'facility_employee') {
        const { data: staff, error: staffError } = await db.from('facility_employees')
          .select('id,facility_id,employee_role,is_active').eq('profile_id', id).eq('is_active', true).maybeSingle();
        if (staffError || !staff) throw new UnauthorizedException('Inactive facility account');
        if (staff.employee_role !== role) throw new UnauthorizedException('Facility role mismatch');
        const { data: facility, error: facilityError } = await db.from('facilities')
          .select('id,is_active').eq('id', staff.facility_id).maybeSingle();
        if (facilityError || !facility?.is_active) throw new UnauthorizedException('Inactive facility');
      }
      return { ...profile, accountRole: role };
    }

    // If customer role is already assigned, account is fully provisioned
    if (codes.includes('customer')) {
      return { ...profile, accountRole: 'customer' };
    }

    // Repair partial provisioning for new customer without extra query if role ID is cached
    let roleId = this.cachedCustomerRoleId;
    if (!roleId) {
      const { data: role, error: roleError } = await db.from('roles').select('id').eq('code', 'customer').single();
      if (roleError || !role) throw new BadRequestException('Customer role unavailable');
      roleId = role.id;
      this.cachedCustomerRoleId = roleId;
    }

    const { error: assignmentError } = await db.from('profile_roles').upsert(
      { profile_id: id, role_id: roleId }, { onConflict: 'profile_id,role_id', ignoreDuplicates: true },
    );
    if (assignmentError) throw new BadRequestException(assignmentError.message);
    const { error: customerError } = await db.from('customers').upsert(
      { profile_id: id, referral_code: `BW${id.replace(/-/g, '').toUpperCase()}` },
      { onConflict: 'profile_id', ignoreDuplicates: true },
    );
    if (customerError) throw new BadRequestException(customerError.message);
    return { ...profile, accountRole: 'customer' };
  }

  async me(userId: string) {
    // userId comes from the global guard's verified JWT, never a request body.
    const { data: profile, error } = await this.s.admin.from('profiles').select('*').eq('id', userId).single();
    if (error) throw new BadRequestException(error.message);
    const { data: roles, error: rolesError } = await this.s.admin.from('profile_roles')
      .select('roles(code,name,role_permissions(permissions(code,name)))').eq('profile_id', userId);
    if (rolesError) throw new BadRequestException(rolesError.message);
    return { profile, roles: roles || [] };
  }

  getRealtimeConfig() {
    return {
      url: this.s.getUrl(),
      anonKey: this.s.getAnonKey(),
    };
  }
}
