import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

import { SupabaseService } from '../supabase/supabase.service';

type OtpType =
  | 'pickup'
  | 'delivery';

@Injectable()
export class OtpService {
  constructor(
    private readonly supabase: SupabaseService,
  ) {}

  private db() {
    return this.supabase.admin;
  }

  private validateType(
    type: string,
  ): asserts type is OtpType {
    if (
      type !== 'pickup' &&
      type !== 'delivery'
    ) {
      throw new BadRequestException(
        'Invalid OTP type',
      );
    }
  }

  private hash(
    otp: string,
  ) {
    const salt =
      randomBytes(16)
        .toString('hex');

    const digest =
      scryptSync(
        otp,
        salt,
        32,
      ).toString('hex');

    return `${salt}:${digest}`;
  }

  private verifyHash(
    otp: string,
    stored: string,
  ) {
    const parts =
      stored.split(':');

    if (
      parts.length !== 2
    ) {
      return false;
    }

    const [
      salt,
      hex,
    ] = parts;

    const expected =
      Buffer.from(
        hex,
        'hex',
      );

    const actual =
      scryptSync(
        otp,
        salt,
        32,
      );

    return (
      expected.length ===
        actual.length &&
      timingSafeEqual(
        expected,
        actual,
      )
    );
  }

  private expectedStatus(
    type: OtpType,
  ) {
    return type === 'pickup'
      ? 'pickup_otp_pending'
      : 'delivery_otp_pending';
  }

  private usesLocalOtpDelivery() {
    return process.env.NODE_ENV !== 'production';
  }

  private async ensureAccess(
    profileId: string,
    orderId: string,
    type: OtpType,
    action: 'create' | 'verify',
  ) {
    const {
      data: order,
      error,
    } = await this.db()
      .from('orders')
      .select(
        'id,current_status,customer_id,customers(profile_id),driver_assignments(driver_id,assignment_type,status,drivers(profile_id))',
      )
      .eq(
        'id',
        orderId,
      )
      .maybeSingle();

    if (
      error ||
      !order
    ) {
      throw new NotFoundException(
        'Order not found',
      );
    }

    const customerOwner =
      (order as any)
        .customers?.profile_id ===
      profileId;

    const assignments =
      (order as any)
        .driver_assignments ??
      [];

    const assignedDriver =
      assignments.some(
        (assignment: any) =>
          assignment
            .assignment_type ===
            type &&
          [
            'assigned',
            'accepted',
            'en_route',
            'arrived',
          ].includes(
            assignment.status,
          ) &&
          assignment.drivers
            ?.profile_id ===
            profileId,
      );

    const {
      data: roles,
      error: roleError,
    } = await this.db()
      .from('profile_roles')
      .select('roles(code)')
      .eq(
        'profile_id',
        profileId,
      );

    if (roleError) {
      throw new ForbiddenException(
        'Unable to verify OTP access',
      );
    }

    const privileged =
      (roles ?? []).some(
        (row: any) =>
          [
            'admin',
            'manager',
          ].includes(
            row.roles?.code,
          ),
      );

    const authorized =
      action === 'create'
        ? customerOwner ||
          privileged
        : assignedDriver ||
          privileged;

    if (!authorized) {
      throw new ForbiddenException(
        'Not authorized for this OTP',
      );
    }

    return order;
  }

  async create(
    profileId: string,
    orderId: string,
    type: string,
  ) {
    this.validateType(type);

    const order =
      await this.ensureAccess(
        profileId,
        orderId,
        type,
        'create',
      );

    const expectedStatus =
      this.expectedStatus(type);

    if (
      order.current_status !==
      expectedStatus
    ) {
      throw new ConflictException(
        `OTP cannot be created while order is ${order.current_status}`,
      );
    }

    if (!this.usesLocalOtpDelivery()) {
      throw new ServiceUnavailableException(
        'OTP delivery is not configured',
      );
    }

    const { data: recentOtp } = await this.db()
      .from('order_otps')
      .select('created_at')
      .eq('order_id', orderId)
      .eq('otp_type', type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentOtp?.created_at) {
      const elapsedMs = Date.now() - new Date(recentOtp.created_at).getTime();
      const COOLDOWN_MS = 10_000;
      if (elapsedMs < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - elapsedMs) / 1000);
        throw new BadRequestException(
          `Please wait ${waitSec} second${waitSec > 1 ? 's' : ''} before requesting a new OTP.`,
        );
      }
    }

    const otp =
      randomInt(
        100000,
        1000000,
      ).toString();

    const expiresAt =
      new Date(
        Date.now() +
          10 * 60 * 1000,
      ).toISOString();

    const {
      data,
      error,
    } = await this.db().rpc(
      'create_order_otp_atomic',
      {
        p_order_id:
          orderId,
        p_otp_type:
          type,
        p_otp_hash:
          this.hash(otp),
        p_expires_at:
          expiresAt,
      },
    );

    if (
      error ||
      !data
    ) {
      throw new BadRequestException(
        error?.message ??
          'Unable to create OTP',
      );
    }

    // Development and UAT deliberately use local mock delivery. Production
    // refuses issuance until a real provider can deliver the code safely.
    return {
      otpId: data.id,
      otp,
      otpType:
        data.otpType,
      expiresAt:
        data.expiresAt,
      delivery: 'local_mock',
    };
  }

  async verify(
    profileId: string,
    orderId: string,
    type: string,
    otp: string,
  ) {
    this.validateType(type);

    if (type === 'delivery') {
      throw new ConflictException(
        'Delivery OTP must be verified with the mandatory delivery photograph',
      );
    }

    const order =
      await this.ensureAccess(
        profileId,
        orderId,
        type,
        'verify',
      );

    const expectedStatus =
      this.expectedStatus(type);

    if (
      order.current_status !==
      expectedStatus
    ) {
      throw new ConflictException(
        `OTP cannot be verified while order is ${order.current_status}`,
      );
    }

    const {
      data,
      error,
    } = await this.db()
      .from('order_otps')
      .select('*')
      .eq(
        'order_id',
        orderId,
      )
      .eq(
        'otp_type',
        type,
      )
      .is(
        'verified_at',
        null,
      )
      .order(
        'created_at',
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

    if (
      error ||
      !data
    ) {
      throw new NotFoundException(
        'No active OTP',
      );
    }

    if (
      new Date(
        data.expires_at,
      ).getTime() <
      Date.now()
    ) {
      throw new BadRequestException(
        'OTP expired',
      );
    }

    const attemptCount =
      Number(
        data.attempt_count ??
          0,
      );

    if (
      attemptCount >= 5
    ) {
      throw new BadRequestException(
        'OTP attempts exceeded',
      );
    }

    if (
      !this.verifyHash(
        otp,
        data.otp_hash,
      )
    ) {
      const {
        data: failedAttemptCount,
        error: attemptError,
      } = await this.db().rpc(
        'record_pickup_otp_failure_attempt',
        {
          p_order_id:
            orderId,
          p_driver_profile_id:
            profileId,
          p_otp_id:
            data.id,
          p_expected_otp_hash:
            String(
              data.otp_hash,
            ),
        },
      );

      if (
        attemptError ||
        typeof failedAttemptCount !==
          'number'
      ) {
        throw new BadRequestException(
          attemptError?.message ??
            'Unable to record pickup OTP attempt',
        );
      }

      throw new BadRequestException(
        'Invalid OTP',
      );
    }

    const {
      data: verification,
      error: completionError,
    } = await this.db().rpc(
      'complete_pickup_otp_verification',
      {
        p_order_id:
          orderId,
        p_driver_profile_id:
          profileId,
        p_otp_id:
          data.id,
        p_validated_otp_hash:
          String(
            data.otp_hash,
          ),
      },
    );

    if (
      completionError ||
      !verification
    ) {
      throw new BadRequestException(
        completionError?.message ??
          'Unable to complete pickup OTP verification',
      );
    }

    try {
      if (typeof this.supabase?.broadcastEvent === 'function') {
        const { data: orderData } = await this.db()
          .from('orders')
          .select('id,order_number,facility_id,customer_id')
          .eq('id', orderId)
          .maybeSingle();

        const payload = {
          eventType: 'ORDER_STATUS_CHANGED',
          entityId: orderId,
          orderId,
          orderNumber: orderData?.order_number,
          status: verification.orderStatus,
          facilityId: orderData?.facility_id,
          timestamp: new Date().toISOString(),
        };

        const broadcasts: Promise<any>[] = [
          this.supabase.broadcastEvent('orders:all', 'ORDER_STATUS_CHANGED', payload),
          this.supabase.broadcastEvent(`order:${orderId}`, 'ORDER_STATUS_CHANGED', payload),
          this.supabase.broadcastEvent('admin:operations', 'ORDER_STATUS_CHANGED', payload),
          this.supabase.broadcastEvent('facility:all', 'ORDER_STATUS_CHANGED', payload),
        ];

        if (orderData?.facility_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`facility:${orderData.facility_id}`, 'ORDER_STATUS_CHANGED', payload),
          );
        }
        if (orderData?.customer_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`customer:${orderData.customer_id}`, 'ORDER_STATUS_CHANGED', payload),
          );
        }

        await Promise.allSettled(broadcasts);
      }
    } catch {
      // Safe catch
    }

    return {
      verified:
        verification.verified,
      orderId:
        verification.orderId,
      otpType:
        verification.otpType,
      orderStatus:
        verification.orderStatus,
    };
  }
}
