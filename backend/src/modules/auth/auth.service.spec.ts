import { AuthService } from './auth.service';
import { hashDriverPin } from './driver-pin.util';

function fixture(failure?: string, active = true, accountRole?: string, facilityActive = true) {
  const calls: string[] = [];
  const db = {
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'verified-user',
              app_metadata: {
                driver_pin_hash: hashDriverPin('123456'),
                employee_pin_hash: hashDriverPin('654321'),
              },
            },
          },
        }),
        updateUserById: jest.fn().mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null }),
      },
    },
    from: jest.fn((table: string) => {
      calls.push(table);
      const data = table === 'roles' ? { id: 'customer-role' }
        : table === 'profile_roles' ? (accountRole ? [{ roles: { code: accountRole } }] : [])
        : table === 'drivers' ? { id: 'staff-record', is_active: active, driver_pin_hash: hashDriverPin('123456') }
        : table === 'facility_employees' ? { id: 'staff-record', facility_id: 'facility-1', employee_role: accountRole, is_active: active }
        : table === 'facilities' ? { id: 'facility-1', name: 'Central Hub', is_active: facilityActive }
        : { id: 'verified-user', is_active: active };
      const result = { data, error: table === failure ? { message: 'database failure' } : null };
      const query: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
      for (const method of ['upsert', 'select', 'eq', 'single', 'maybeSingle']) query[method] = jest.fn(() => query);
      return query;
    }),
  };
  const user = { id: 'verified-user', phone: '16505550101' };
  const session = {
    access_token: 'test-access-token',
    refresh_token: 'test-rotated-refresh-token',
  };
  const verifyOtp = jest.fn().mockResolvedValue({
    data: { user, session },
    error: null,
  });
  const refreshSession = jest.fn().mockResolvedValue({
    data: { user, session },
    error: null,
  });
  const signUp = jest.fn().mockResolvedValue({
    data: { user, session },
    error: null,
  });
  const signInWithPassword = jest.fn().mockResolvedValue({
    data: { user, session },
    error: null,
  });
  const resetPasswordForEmail = jest.fn().mockResolvedValue({
    data: {},
    error: null,
  });
  const updateUser = jest.fn().mockResolvedValue({
    data: { user },
    error: null,
  });
  const createAuthClient = jest.fn(() => ({
    auth: { verifyOtp, refreshSession, signUp, signInWithPassword, resetPasswordForEmail },
  }));
  const createUserClient = jest.fn(() => ({
    auth: { updateUser },
  }));
  return {
    service: new AuthService({ admin: db, createAuthClient, createUserClient } as any),
    db,
    calls,
    createAuthClient,
    createUserClient,
    verifyOtp,
    refreshSession,
    signUp,
    signInWithPassword,
    resetPasswordForEmail,
    updateUser,
    session,
    user,
  };
}

describe('AuthService provisioning', () => {
  it('provisions customer and role even when the profile trigger already created a profile', async () => {
    const f = fixture();
    await f.service.verifyOtp('+16505550101', '123456');
    expect(f.calls).toEqual(['profiles', 'profiles', 'profile_roles', 'roles', 'profile_roles', 'customers']);
    expect(f.createAuthClient).toHaveBeenCalledTimes(1);
  });
  it.each(['profiles', 'roles', 'profile_roles', 'customers'])('surfaces %s provisioning failures', async table => {
    await expect(fixture(table).service.ensureProfile('verified-user')).rejects.toThrow();
  });
  it('rejects inactive profiles before assigning roles or creating customers', async () => {
    const f = fixture(undefined, false);
    await expect(f.service.ensureProfile('verified-user')).rejects.toThrow('Inactive');
    expect(f.calls).toEqual(['profiles', 'profiles']);
  });
  it('does not provision when verification fails', async () => {
    const f = fixture();
    f.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid OTP' } } as any);
    await expect(f.service.verifyOtp('+16505550101', '000000')).rejects.toThrow('Invalid OTP');
    expect(f.db.from).not.toHaveBeenCalled();
  });

  it('refreshes a session with an isolated auth client and repairs provisioning', async () => {
    const f = fixture();

    const result = await f.service.refresh('submitted-refresh-token');

    expect(f.createAuthClient).toHaveBeenCalledTimes(1);
    expect(f.refreshSession).toHaveBeenCalledWith({
      refresh_token: 'submitted-refresh-token',
    });
    expect(f.calls).toEqual(['profiles', 'profiles', 'profile_roles', 'roles', 'profile_roles', 'customers']);
    expect(result).toEqual({
      session: f.session,
      user: f.user,
      profile: { id: 'verified-user', is_active: true, accountRole: 'customer' },
    });
  });

  it('keeps an Admin-provisioned driver out of customer provisioning on OTP and refresh', async () => {
    const f = fixture(undefined, true, 'driver');
    const verified = await f.service.verifyOtp('+16505550101', '123456');
    expect(verified.profile.accountRole).toBe('driver');
    await f.service.refresh('refresh-token');
    expect(f.calls).not.toContain('customers');
    expect(f.calls).not.toContain('roles');
    expect(f.calls.filter(name => name === 'drivers')).toHaveLength(2);
  });

  it.each(['facility_employee', 'manager'])('keeps %s out of customer provisioning', async role => {
    const f = fixture(undefined, true, role);
    const verified = await f.service.verifyOtp('+16505550103', '123456');
    expect(verified.profile.accountRole).toBe(role);
    expect(f.calls).toContain('facility_employees');
    expect(f.calls).not.toContain('customers');
  });

  it('preserves a privileged Admin OTP session and refresh without customer provisioning', async () => {
    const f = fixture(undefined, true, 'admin');
    const verified = await f.service.verifyOtp('+16505550106', 'local-code');
    expect(verified.profile.accountRole).toBe('admin');
    const refreshed = await f.service.refresh('refresh-token');
    expect(refreshed.profile.accountRole).toBe('admin');
    expect(f.calls).not.toContain('customers');
    expect(f.calls).not.toContain('roles');
  });

  it('blocks a disabled Admin on OTP and refresh', async () => {
    const f = fixture(undefined, false, 'admin');
    await expect(f.service.verifyOtp('+16505550106', 'local-code')).rejects.toThrow('Inactive');
    await expect(f.service.refresh('refresh-token')).rejects.toThrow('Inactive');
  });

  it('blocks Facility login and session refresh after assigned facility is disabled', async () => {
    const f = fixture(undefined, true, 'facility_employee', false);
    await expect(f.service.verifyOtp('+16505550103', '123456')).rejects.toThrow('Inactive facility');
    await expect(f.service.refresh('refresh-token')).rejects.toThrow('Inactive facility');
    expect(f.calls).not.toContain('customers');
  });

  it('rejects a privileged profile with mixed customer and staff roles', async () => {
    const f = fixture(undefined, true, 'driver');
    const original = f.db.from;
    f.db.from = jest.fn((table: string) => {
      const query = original(table);
      if (table === 'profile_roles') query.then = (resolve: any) =>
        Promise.resolve({ data: [{ roles: { code: 'driver' } }, { roles: { code: 'customer' } }], error: null }).then(resolve);
      return query;
    });
    await expect(f.service.ensureProfile('verified-user')).rejects.toThrow('Conflicting account roles');
  });

  it('rejects an invalid refresh session without provisioning or exposing provider details', async () => {
    const f = fixture();
    f.refreshSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'provider detail containing sensitive context' },
    } as any);

    await expect(f.service.refresh('submitted-refresh-token')).rejects.toThrow(
      'Invalid or expired refresh session',
    );
    expect(f.db.from).not.toHaveBeenCalled();
  });

  it.each([
    { user: null, session: { access_token: 'test-token' } },
    { user: { id: 'verified-user' }, session: null },
  ])('rejects an incomplete refresh response', async data => {
    const f = fixture();
    f.refreshSession.mockResolvedValue({ data, error: null } as any);

    await expect(f.service.refresh('submitted-refresh-token')).rejects.toThrow(
      'Invalid or expired refresh session',
    );
    expect(f.db.from).not.toHaveBeenCalled();
  });

  describe('Customer Email/Password Authentication', () => {
    it('signs up customer with immediate session and provisions customer profile', async () => {
      const f = fixture();
      const result = await f.service.signUp('test@example.com', 'SecurePass123!', 'John Doe', '+16505550101');
      expect(f.createAuthClient).toHaveBeenCalledTimes(1);
      expect(f.signUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'SecurePass123!',
        options: {
          data: {
            full_name: 'John Doe',
            phone: '+16505550101',
          },
        },
      });
      expect(result.requiresEmailConfirmation).toBe(false);
      expect(result.session).toEqual(f.session);
      expect(result.profile.accountRole).toBe('customer');
      expect(f.calls).toContain('customers');
    });

    it('signs up customer when email confirmation is required', async () => {
      const f = fixture();
      f.signUp.mockResolvedValueOnce({
        data: { user: { id: 'unconfirmed-user', email: 'pending@example.com' }, session: null },
        error: null,
      });
      const result = await f.service.signUp('pending@example.com', 'SecurePass123!', 'Jane Doe');
      expect(result.requiresEmailConfirmation).toBe(true);
      expect(result.session).toBeNull();
      expect(result.message).toContain('check your email to verify');
      expect(f.calls).toHaveLength(0); // ensureProfile not called until verified
    });

    it('translates duplicate email error into friendly user-facing message', async () => {
      const f = fixture();
      f.signUp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'User already registered' },
      });
      await expect(f.service.signUp('existing@example.com', 'SecurePass123!', 'John Doe'))
        .rejects.toThrow('An account with this email already exists.');
    });

    it('signs in customer with valid credentials and establishes session', async () => {
      const f = fixture();
      const result = await f.service.signIn('test@example.com', 'SecurePass123!');
      expect(f.createAuthClient).toHaveBeenCalledTimes(1);
      expect(f.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'SecurePass123!',
      });
      expect(result.session).toEqual(f.session);
      expect(result.profile.accountRole).toBe('customer');
    });

    it('rejects sign in with invalid password using friendly message', async () => {
      const f = fixture();
      f.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });
      await expect(f.service.signIn('test@example.com', 'WrongPass!'))
        .rejects.toThrow('Invalid email or password.');
    });

    it('rejects sign in when email is not confirmed', async () => {
      const f = fixture();
      f.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Email not confirmed' },
      });
      await expect(f.service.signIn('test@example.com', 'Pass123!'))
        .rejects.toThrow('Please verify your email before signing in.');
    });

    it('handles forgot password request without exposing email existence', async () => {
      const f = fixture();
      const result = await f.service.forgotPassword('unknown@example.com');
      expect(f.resetPasswordForEmail).toHaveBeenCalledWith('unknown@example.com', {
        redirectTo: 'http://localhost:5173/auth/reset-password',
      });
      expect(result).toEqual({ sent: true });
    });

    it('resets password using user recovery access token', async () => {
      const f = fixture();
      const result = await f.service.resetPassword('recovery-token', 'NewSecurePass123!');
      expect(f.createUserClient).toHaveBeenCalledWith('recovery-token');
      expect(f.updateUser).toHaveBeenCalledWith({ password: 'NewSecurePass123!' });
      expect(result).toEqual({ success: true });
    });
  });

  describe('Staff PIN Authentication (Driver & Facility Employee)', () => {
    it('authenticates driver with valid phone and 6-digit PIN', async () => {
      const f = fixture(undefined, true, 'driver');
      const result = await f.service.driverSignIn('+919876543210', '123456');
      expect(result.session).toEqual(f.session);
      expect(result.user.phone).toBe('+919876543210');
      expect(f.signInWithPassword).toHaveBeenCalledWith({
        email: 'driver.919876543210@brightwhite.internal',
        password: '123456',
      });
    });

    it('rejects driver sign in with wrong PIN', async () => {
      const f = fixture(undefined, true, 'driver');
      await expect(f.service.driverSignIn('+919876543210', '000000'))
        .rejects.toThrow('Invalid phone number or PIN.');
    });

    it('rejects driver sign in for inactive profile', async () => {
      const f = fixture(undefined, false, 'driver');
      await expect(f.service.driverSignIn('+919876543210', '123456'))
        .rejects.toThrow('Invalid phone number or PIN.');
    });

    it('authenticates facility employee with valid phone and 6-digit PIN', async () => {
      const f = fixture(undefined, true, 'facility_employee');
      const result = await f.service.facilitySignIn('+919876543210', '654321');
      expect(result.session).toEqual(f.session);
      expect(result.user.phone).toBe('+919876543210');
      expect(result.facility).toEqual({ id: 'facility-1', name: 'Central Hub' });
      expect(f.signInWithPassword).toHaveBeenCalledWith({
        email: 'facility.919876543210@brightwhite.internal',
        password: '654321',
      });
    });

    it('rejects facility employee sign in when assigned facility is inactive', async () => {
      const f = fixture(undefined, true, 'facility_employee', false);
      await expect(f.service.facilitySignIn('+919876543210', '654321'))
        .rejects.toThrow('Invalid phone number or PIN.');
    });

    it('rejects facility employee sign in with invalid phone format', async () => {
      const f = fixture(undefined, true, 'facility_employee');
      await expect(f.service.facilitySignIn('not-a-phone', '654321'))
        .rejects.toThrow('Invalid phone number or PIN.');
    });

    it('rejects facility employee sign in for non-facility role', async () => {
      const f = fixture(undefined, true, 'customer');
      await expect(f.service.facilitySignIn('+919876543210', '654321'))
        .rejects.toThrow('Invalid phone number or PIN.');
    });

    it('unified staffSignIn resolves driver and facility employee cleanly', async () => {
      const fDriver = fixture(undefined, true, 'driver');
      const resDriver = await fDriver.service.staffSignIn('+919876543210', '123456');
      expect(resDriver.session).toEqual(fDriver.session);

      const fEmp = fixture(undefined, true, 'facility_employee');
      const resEmp: any = await fEmp.service.staffSignIn('+919876543210', '654321');
      expect(resEmp.session).toEqual(fEmp.session);
      expect(resEmp.facility?.name).toBe('Central Hub');
    });
  });
});
