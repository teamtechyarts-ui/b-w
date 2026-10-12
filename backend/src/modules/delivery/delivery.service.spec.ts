import { BadRequestException } from '@nestjs/common';
import { scryptSync } from 'crypto';
import { DeliveryService } from './delivery.service';

function query(result: unknown) {
  const chain: any = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'order',
    'limit',
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest
    .fn()
    .mockResolvedValue({
      data: result,
      error: null,
    });
  return chain;
}

describe('DeliveryService', () => {
  it('delegates all successful delivery writes without photo to the atomic RPC', async () => {
    const salt = 'runtime-test-salt';
    const otp = '654321';
    const otpHash = `${salt}:${scryptSync(
      otp,
      salt,
      32,
    ).toString('hex')}`;
    const rows: Record<string, unknown> = {
      drivers: {
        id: 'driver-1',
        is_active: true,
      },
      driver_assignments: {
        id: 'assignment-1',
        order_id: 'order-1',
        driver_id: 'driver-1',
        assignment_type: 'delivery',
        status: 'arrived',
      },
      orders: {
        id: 'order-1',
        current_status:
          'delivery_otp_pending',
      },
      order_otps: {
        id: 'otp-1',
        otp_hash: otpHash,
        expires_at: new Date(
          Date.now() + 60_000,
        ).toISOString(),
        attempt_count: 0,
      },
    };
    const rpc = jest
      .fn()
      .mockResolvedValue({
        data: {
          orderId: 'order-1',
          assignmentId:
            'assignment-1',
          delivered: true,
          orderStatus:
            'claim_period_active',
          assignmentStatus:
            'completed',
          claimPeriodDays: 7,
        },
        error: null,
      });
    const service = new DeliveryService(
      {
        admin: {
          from: jest.fn(
            (table: string) =>
              query(rows[table]),
          ),
          rpc,
        },
      } as any,
      {} as any,
    );

    await expect(
      service.complete(
        'profile-1',
        'order-1',
        otp,
      ),
    ).resolves.toMatchObject({
      delivered: true,
      orderStatus:
        'claim_period_active',
      assignmentStatus:
        'completed',
    });

    expect(rpc).toHaveBeenCalledTimes(
      1,
    );
    expect(rpc).toHaveBeenCalledWith(
      'complete_delivery_atomic',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_driver_profile_id:
          'profile-1',
        p_otp_id: 'otp-1',
        p_validated_otp_hash:
          otpHash,
        p_photo_path: null,
      }),
    );
  });

  it('rejects empty or malformed OTP', async () => {
    const service = new DeliveryService({} as any, {} as any);
    await expect(
      service.complete('profile-1', 'order-1', ''),
    ).rejects.toThrow('Delivery OTP is required');

    await expect(
      service.complete('profile-1', 'order-1', '123'),
    ).rejects.toThrow('Delivery OTP must be 6 digits');
  });

  it('serializes each failed OTP attempt through the database RPC', async () => {
    const salt =
      'runtime-test-salt';
    const otpHash = `${salt}:${scryptSync(
      '654321',
      salt,
      32,
    ).toString('hex')}`;
    const rows: Record<
      string,
      unknown
    > = {
      drivers: {
        id: 'driver-1',
        is_active: true,
      },
      driver_assignments: {
        id: 'assignment-1',
        order_id: 'order-1',
        driver_id: 'driver-1',
        assignment_type:
          'delivery',
        status: 'arrived',
      },
      orders: {
        id: 'order-1',
        current_status:
          'delivery_otp_pending',
      },
      order_otps: {
        id: 'otp-1',
        otp_hash: otpHash,
        expires_at: new Date(
          Date.now() + 60_000,
        ).toISOString(),
        attempt_count: 0,
      },
    };
    const rpc = jest
      .fn()
      .mockResolvedValue({
        data: 1,
        error: null,
      });
    const service =
      new DeliveryService(
        {
          admin: {
            from: jest.fn(
              (table: string) =>
                query(
                  rows[table],
                ),
            ),
            rpc,
          },
        } as any,
        {} as any,
      );

    await expect(
      service.complete(
        'profile-1',
        'order-1',
        '000000',
      ),
    ).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(rpc).toHaveBeenCalledTimes(
      1,
    );
    expect(rpc).toHaveBeenCalledWith(
      'record_delivery_otp_failure_attempt',
      {
        p_order_id: 'order-1',
        p_otp_id: 'otp-1',
        p_expected_otp_hash:
          otpHash,
      },
    );
  });
});
