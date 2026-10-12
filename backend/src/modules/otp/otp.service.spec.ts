import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {scryptSync} from 'crypto';
import {OtpService} from './otp.service';

function query(result: unknown) {
  const chain: any = {};
  for (const method of [
    'select', 'eq', 'is', 'order', 'limit',
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn().mockResolvedValue({data: result, error: null});
  return chain;
}

function otpHash(otp: string) {
  const salt = 'runtime-test-salt';
  return `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`;
}

function createService(options: {
  order?: unknown;
  otp?: unknown;
  roles?: unknown;
  rpc?: jest.Mock;
} = {}) {
  const order = options.order ?? {
    id: 'order-1',
    current_status: 'pickup_otp_pending',
    customers: {profile_id: 'customer-profile'},
    driver_assignments: [{
      assignment_type: 'pickup',
      status: 'arrived',
      drivers: {profile_id: 'driver-profile'},
    }],
  };
  const rows: Record<string, unknown> = {
    orders: order,
    profile_roles: options.roles ?? [],
    order_otps: options.otp === undefined ? {
      id: 'otp-1',
      otp_hash: otpHash('123456'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempt_count: 0,
    } : options.otp,
  };
  const rpc = options.rpc ?? jest.fn().mockResolvedValue({
    data: {
      verified: true,
      orderId: 'order-1',
      otpType: 'pickup',
      orderStatus: 'picked_up',
    },
    error: null,
  });
  const from = jest.fn((table: string) => query(rows[table]));
  return {service: new OtpService({admin: {from, rpc}} as any), from, rpc};
}

describe('OtpService', () => {
  it('verifies a valid pickup OTP through the approved atomic transition', async () => {
    const {service, rpc} = createService();

    await expect(
      service.verify('driver-profile', 'order-1', 'pickup', '123456'),
    ).resolves.toMatchObject({verified: true, orderStatus: 'picked_up'});

    expect(rpc).toHaveBeenCalledWith(
      'complete_pickup_otp_verification',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_driver_profile_id: 'driver-profile',
        p_otp_id: 'otp-1',
      }),
    );
  });

  it('rejects an invalid pickup OTP and records the attempt atomically', async () => {
    const {service, rpc} = createService();

    await expect(
      service.verify('driver-profile', 'order-1', 'pickup', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(rpc).toHaveBeenCalledWith(
      'record_pickup_otp_failure_attempt',
      expect.objectContaining({p_order_id: 'order-1', p_otp_id: 'otp-1'}),
    );
  });

  it('rejects expired and reused OTPs', async () => {
    const expired = createService({
      otp: {
        id: 'otp-1',
        otp_hash: otpHash('123456'),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        attempt_count: 0,
      },
    });
    await expect(
      expired.service.verify('driver-profile', 'order-1', 'pickup', '123456'),
    ).rejects.toThrow('OTP expired');

    const reused = createService({otp: null});
    await expect(
      reused.service.verify('driver-profile', 'order-1', 'pickup', '123456'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a driver attempting a different order', async () => {
    const {service} = createService({
      order: {
        id: 'order-2',
        current_status: 'pickup_otp_pending',
        customers: {profile_id: 'customer-profile'},
        driver_assignments: [],
      },
    });

    await expect(
      service.verify('driver-profile', 'order-2', 'pickup', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns OTPs only through local mock delivery', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const {service, rpc} = createService();

    await expect(
      service.create('customer-profile', 'order-1', 'pickup'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rpc).not.toHaveBeenCalled();

    process.env.NODE_ENV = previousNodeEnv;
  });

  it('creates an OTP when authorized and in valid state', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        id: 'new-otp-1',
        otpType: 'pickup',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
      error: null,
    });
    const {service} = createService({rpc, otp: null});

    const result = await service.create('customer-profile', 'order-1', 'pickup');
    expect(result).toMatchObject({
      otpId: 'new-otp-1',
      otpType: 'pickup',
      delivery: 'local_mock',
    });
    expect(rpc).toHaveBeenCalledWith(
      'create_order_otp_atomic',
      expect.objectContaining({p_order_id: 'order-1', p_otp_type: 'pickup'}),
    );
  });

  it('rejects rapid repeated OTP regeneration within cooldown period', async () => {
    const recentOtp = {
      id: 'otp-recent',
      otp_hash: otpHash('123456'),
      created_at: new Date(Date.now() - 2_000).toISOString(), // generated 2 seconds ago
    };
    const {service} = createService({otp: recentOtp});

    await expect(
      service.create('customer-profile', 'order-1', 'pickup'),
    ).rejects.toThrow(/Please wait/);
  });
});

