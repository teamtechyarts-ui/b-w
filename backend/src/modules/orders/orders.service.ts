import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";

import { SupabaseService } from "../supabase/supabase.service";
import { GrowthService } from "../growth/growth.service";
import { PackagesService } from "../packages/packages.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { calculateOrderPricing } from "./order-pricing";
import { CUSTOMER_TERMS_VERSION } from "./order-terms";

export interface ServiceabilityResult {
  serviceable: boolean;
  facilityId?: string;
  facilityName?: string;
  facilityAddress?: string | null;
  pincode?: string;
  distanceMeters?: number;
  serviceRadiusMeters?: number;
  reason?: 'INVALID_PINCODE' | 'OUTSIDE_SERVICE_AREA' | 'NO_ACTIVE_FACILITIES';
  message?: string;
}

const MAX_CUSTOMER_CACHE_SIZE = 1000;
const CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function invalidateCustomerCache(profileId?: string): void {
  if (profileId) {
    OrdersService.customerIdCache.delete(profileId);
  } else {
    OrdersService.customerIdCache.clear();
  }
}

export function getCustomerCacheSize(): number {
  return OrdersService.customerIdCache.size;
}

@Injectable()
export class OrdersService {
  static readonly customerIdCache = new Map<string, { id: string; expiresAt: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly growth?: GrowthService,
    private readonly packages?: PackagesService,
  ) {}

  private db() {
    return this.supabase.admin;
  }

  private async customerId(profileId: string): Promise<string> {
    const cached = OrdersService.customerIdCache.get(profileId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.id;
    }

    const { data, error } = await this.db()
      .from("customers")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error || !data) {
      throw new ForbiddenException("Customer profile required");
    }

    // Evict oldest if bounded cache limit reached
    if (OrdersService.customerIdCache.size >= MAX_CUSTOMER_CACHE_SIZE) {
      const oldestKey = OrdersService.customerIdCache.keys().next().value;
      if (oldestKey) OrdersService.customerIdCache.delete(oldestKey);
    }

    // Cache customer ID for 5 minutes
    OrdersService.customerIdCache.set(profileId, {
      id: data.id,
      expiresAt: Date.now() + CUSTOMER_CACHE_TTL_MS,
    });

    return data.id;
  }

  async checkServiceability(
    profileId: string,
    pickupAddressId: string,
  ): Promise<ServiceabilityResult> {
    const customerId = await this.customerId(profileId);
    return this.resolveServiceability(customerId, pickupAddressId);
  }

  private async resolveServiceability(
    customerId: string,
    pickupAddressId: string,
  ): Promise<ServiceabilityResult> {
    const { data: address, error: addressError } = await this.db()
      .from('customer_addresses')
      .select('id, postal_code, label, address_line1, address_line2, city, state')
      .eq('id', pickupAddressId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (addressError || !address) {
      throw new BadRequestException('Pickup address does not belong to customer');
    }

    const rawPincode = address.postal_code ? String(address.postal_code).trim() : '';

    if (!rawPincode || !/^\d{6}$/.test(rawPincode)) {
      return {
        serviceable: false,
        reason: 'INVALID_PINCODE',
        message: 'Please enter a valid 6-digit pincode.',
      };
    }

    // Lookup serviceable active facilities for this pincode
    const { data: pincodeRows, error: pinErr } = await this.db()
      .from('facility_service_pincodes')
      .select('facility_id, pincode')
      .eq('pincode', rawPincode);

    if (pinErr) {
      throw new BadRequestException(pinErr.message || 'Unable to verify serviceability for this pincode');
    }

    if (!pincodeRows || pincodeRows.length === 0) {
      return {
        serviceable: false,
        pincode: rawPincode,
        reason: 'OUTSIDE_SERVICE_AREA',
        message: 'We currently do not provide pickup and delivery service in your pincode.',
      };
    }

    const facilityIds = pincodeRows.map((r: any) => r.facility_id);
    const { data: activeFacilities, error: facErr } = await this.db()
      .from('facilities')
      .select('id, name, address, is_active')
      .in('id', facilityIds)
      .eq('is_active', true);

    if (facErr) {
      throw new BadRequestException(facErr.message || 'Unable to verify facility availability');
    }

    if (!activeFacilities || activeFacilities.length === 0) {
      return {
        serviceable: false,
        pincode: rawPincode,
        reason: 'OUTSIDE_SERVICE_AREA',
        message: 'We currently do not provide pickup and delivery service in your pincode.',
      };
    }

    // Deterministic selection: sort by name ASC, id ASC
    activeFacilities.sort((a: any, b: any) =>
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );

    const selected = activeFacilities[0];

    return {
      serviceable: true,
      facilityId: selected.id,
      facilityName: selected.name,
      facilityAddress: selected.address,
      pincode: rawPincode,
    };
  }

  async create(profileId: string, dto: CreateOrderDto) {
    const customerId = await this.customerId(profileId);
    const requestHash = dto.idempotencyKey
      ? createHash("sha256")
          .update(JSON.stringify({ ...dto, idempotencyKey: undefined }))
          .digest("hex")
      : null;
    const existingOrder = async () => {
      if (!dto.idempotencyKey) return null;
      const { data, error } = await this.db()
        .from("orders")
        .select("id, idempotency_request_hash")
        .eq("customer_id", customerId)
        .eq("idempotency_key", dto.idempotencyKey)
        .maybeSingle();
      if (error) throw new BadRequestException("Unable to verify order retry");
      if (!data) return null;
      if (data.idempotency_request_hash !== requestHash) {
        throw new ConflictException(
          "This order retry key was used with a different checkout",
        );
      }
      return this.getById(profileId, data.id);
    };
    const priorOrder = await existingOrder();
    if (priorOrder) return priorOrder;

    try {
      return await this.createNewOrder(profileId, customerId, dto, requestHash);
    } catch (error) {
      // A concurrent request can win the unique key while this one is still pricing.
      const concurrentOrder = await existingOrder();
      if (concurrentOrder) return concurrentOrder;
      throw error;
    }
  }

  private async createNewOrder(
    profileId: string,
    customerId: string,
    dto: CreateOrderDto,
    requestHash: string | null,
  ) {
    /*
     * Validate pickup date/time.
     * The customer cannot schedule a pickup in the past.
     */
    const pickupScheduledAt = new Date(dto.pickupScheduledAt);

    if (Number.isNaN(pickupScheduledAt.getTime())) {
      throw new BadRequestException("Invalid pickup schedule");
    }

    if (pickupScheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException("Pickup time must be in the future");
    }

    /*
     * Verify delivery address belongs to this customer.
     */
    const { data: delAddress, error: delAddressError } = await this.db()
      .from("customer_addresses")
      .select("id")
      .eq("id", dto.deliveryAddressId)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (delAddressError || !delAddress) {
      throw new BadRequestException("Address does not belong to customer");
    }

    /*
     * Authoritative Serviceability Check:
     * Resolves the nearest active facility within its service radius.
     */
    const serviceability = await this.resolveServiceability(customerId, dto.pickupAddressId);
    if (!serviceability.serviceable) {
      throw new BadRequestException(
        serviceability.message || "Your pickup location is outside our service area."
      );
    }

    const assignedFacilityId = serviceability.facilityId!;

    let subtotal = 0;
    const seenServices = new Set<string>();

    const items: Array<{
      service_id: string;
      item_name: string;
      quantity: number;
      weight_kg: number | null;
      unit_price: number;
      line_total: number;
      customer_notes: string | null;
    }> = [];

    const now = new Date().toISOString();

    /*
     * Validate services and calculate
     * pricing on the server.
     */
    for (const item of dto.items) {
      if (seenServices.has(item.serviceId)) {
        throw new BadRequestException("Duplicate service in order");
      }
      seenServices.add(item.serviceId);
      const { data: service, error: serviceError } = await this.db()
        .from("services")
        .select("id,name,is_active,category_id")
        .eq("id", item.serviceId)
        .maybeSingle();

      if (serviceError || !service?.is_active) {
        throw new BadRequestException(`Invalid service ${item.serviceId}`);
      }
      if (service.category_id) {
        const { data: category, error: categoryError } = await this.db()
          .from("service_categories")
          .select("is_active")
          .eq("id", service.category_id)
          .maybeSingle();
        if (categoryError || !category?.is_active)
          throw new BadRequestException(
            `Unavailable service ${item.serviceId}`,
          );
      }

      let priceQuery = this.db()
        .from("service_prices")
        .select("price")
        .eq("service_id", item.serviceId)
        .lte("effective_from", now)
        .or(`effective_to.is.null,effective_to.gt.${now}`)
        .order("effective_from", {
          ascending: false,
        })
        .limit(1);

      if (dto.facilityId) {
        priceQuery = priceQuery.eq("facility_id", dto.facilityId);
      } else {
        priceQuery = priceQuery.is("facility_id", null);
      }

      const { data: prices, error: priceError } = await priceQuery;

      if (priceError || !prices?.length) {
        throw new BadRequestException(
          `No active price for service ${item.serviceId}`,
        );
      }

      const unitPrice = Number(prices[0].price);

      const lineTotal = unitPrice * item.quantity;

      subtotal += lineTotal;

      items.push({
        service_id: item.serviceId,

        item_name: item.itemName,

        quantity: item.quantity,

        weight_kg: item.weightKg ?? null,

        unit_price: unitPrice,

        line_total: lineTotal,

        customer_notes: item.customerNotes ?? null,
      });
    }

    /*
     * Calculate customer-facing pricing
     * on the server.
     *
     * Rule:
     * - subtotal below ₹500:
     *   ₹50 pickup/delivery charge
     * - subtotal ₹500 or above:
     *   free pickup/delivery
     * - GST:
     *   5% of subtotal + pickup/delivery charge
     */
    if (dto.couponCode && !this.growth) {
      throw new BadRequestException("Coupon validation unavailable");
    }
    const coupon = dto.couponCode
      ? await this.growth!.applyCoupon(profileId, dto.couponCode, subtotal)
      : null;
    if (dto.packageSubscriptionId && !this.packages) {
      throw new BadRequestException("Package validation unavailable");
    }
    const packageQuote = dto.packageSubscriptionId
      ? await this.packages!.quote(profileId, dto.packageSubscriptionId, items)
      : null;
    if (packageQuote && packageQuote.coverages.length === 0) {
      throw new BadRequestException(
        "No eligible package credits for this order",
      );
    }
    const packageDiscount = packageQuote?.discount ?? 0;
    const couponDiscount = Math.min(
      coupon?.discount ?? 0,
      Math.max(0, subtotal - packageDiscount),
    );
    const points = dto.loyaltyPointsToRedeem ?? 0;
    const { data: growthRules, error: growthRulesError } = await this.db()
      .from("admin_growth_settings")
      .select("loyalty_points_per_rupee,loyalty_minimum_redemption_rupees")
      .eq("id", true)
      .single();
    if (growthRulesError || !growthRules)
      throw new BadRequestException("Loyalty rules unavailable");
    const pointsPerRupee = Number(growthRules.loyalty_points_per_rupee);
    const minimumPoints = Math.ceil(
      Number(growthRules.loyalty_minimum_redemption_rupees) * pointsPerRupee,
    );
    if (
      !Number.isSafeInteger(points) ||
      points < 0 ||
      (points > 0 && points < minimumPoints) ||
      points >
        Math.round(
          (subtotal - couponDiscount - packageDiscount) * pointsPerRupee,
        )
    ) {
      throw new BadRequestException("Invalid loyalty points for this order");
    }
    const loyaltyDiscount = points / pointsPerRupee;
    const { data: policyRow, error: policyError } = await this.db()
      .from("checkout_pricing_policies")
      .select(
        "pickup_delivery_fee,free_delivery_threshold,gst_rate_percent,minimum_order_amount",
      )
      .lte("effective_from", now)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (policyError || !policyRow)
      throw new BadRequestException(
        "Checkout pricing configuration unavailable",
      );
    if (subtotal < Number(policyRow.minimum_order_amount))
      throw new BadRequestException("Order is below the minimum order amount");
    const pricing = calculateOrderPricing(
      subtotal,
      couponDiscount + loyaltyDiscount + packageDiscount,
      {
        pickupDeliveryFee: Number(policyRow.pickup_delivery_fee),
        freeDeliveryThreshold: Number(policyRow.free_delivery_threshold),
        gstRatePercent: Number(policyRow.gst_rate_percent),
      },
    );

    /*
     * Razorpay orders first wait for payment.
     * Other supported payment methods
     * can move directly to confirmed.
     */
    const targetStatus =
      dto.paymentMethod === "razorpay" ? "pending_payment" : "confirmed";

    const rewardOrderPayload = {
      facility_id: assignedFacilityId,
      pickup_address_id: dto.pickupAddressId,
      delivery_address_id: dto.deliveryAddressId,
      pickup_scheduled_at: dto.pickupScheduledAt,
      pickup_slot_label: dto.pickupSlotLabel,
      subtotal: pricing.subtotal,
      discount_amount: pricing.discountAmount,
      coupon_offer_id: coupon?.offerId ?? null,
      coupon_discount_amount: couponDiscount,
      package_discount_amount: packageDiscount,
      loyalty_discount_amount: loyaltyDiscount,
      pickup_delivery_charge: pricing.pickupDeliveryCharge,
      taxable_amount: pricing.taxableAmount,
      gst_rate: pricing.gstRate,
      gst_amount: pricing.gstAmount,
      total_amount: pricing.totalAmount,
      payment_method: dto.paymentMethod,
      terms_version: CUSTOMER_TERMS_VERSION,
      idempotency_key: dto.idempotencyKey ?? null,
      idempotency_request_hash: requestHash,
    };

    if (packageQuote) {
      const { data: orderId, error } = await this.db().rpc(
        "create_customer_order_with_package_atomic",
        {
          p_customer_id: customerId,
          p_order: rewardOrderPayload,
          p_items: items,
          p_target_status: targetStatus,
          p_points: points,
          p_subscription_id: packageQuote.subscriptionId,
          p_coverages: packageQuote.coverages,
        },
      );
      if (error || !orderId)
        throw new BadRequestException(
          error?.message ?? "Unable to use package credits",
        );
      return this.getById(profileId, orderId);
    }

    const { data: orderId, error } = await this.db().rpc(
      "create_customer_order_with_rewards_atomic",
      {
        p_customer_id: customerId,
        p_order: rewardOrderPayload,
        p_items: items,
        p_target_status: targetStatus,
        p_points: points,
      },
    );
    if (error || !orderId) {
      throw new BadRequestException(error?.message ?? "Unable to create order");
    }

    const orderResult = await this.getById(profileId, orderId);

    // If order moves directly to confirmed, notify driver pool, admin, and customer immediately
    if (targetStatus === "confirmed") {
      const broadcastPayload = {
        eventType: "ORDER_CREATED",
        entityId: orderId,
        orderId,
        orderNumber: orderResult.order_number,
        status: "confirmed",
        facilityId: assignedFacilityId,
        jobType: "pickup",
        timestamp: new Date().toISOString(),
      };

      if (typeof this.supabase?.broadcastEvent === "function") {
        await Promise.allSettled([
          this.supabase.broadcastEvent("driver:available", "JOB_AVAILABLE", broadcastPayload),
          this.supabase.broadcastEvent("jobs:drivers", "JOB_AVAILABLE", broadcastPayload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_CREATED", broadcastPayload),
          this.supabase.broadcastEvent(`customer:${customerId}`, "ORDER_STATUS_CHANGED", broadcastPayload),
          this.supabase.broadcastEvent(`customer:${profileId}`, "ORDER_STATUS_CHANGED", broadcastPayload),
          this.supabase.broadcastEvent(`facility:${assignedFacilityId}`, "ORDER_CREATED", broadcastPayload),
          this.supabase.broadcastEvent(`order:${orderId}`, "ORDER_CREATED", broadcastPayload),
        ]);
      }
    }

    return orderResult;
  }

  async cancel(profileId: string, orderId: string, reason: string) {
    const { data, error } = await this.db().rpc(
      "cancel_customer_order_atomic",
      {
        p_order_id: orderId,

        p_profile_id: profileId,

        p_reason: reason,
      },
    );

    if (error?.code === "P0002") {
      throw new NotFoundException(error.message ?? "Order not found");
    }

    if (error?.code === "42501") {
      throw new ForbiddenException(
        error.message ?? "Order belongs to another customer",
      );
    }

    if (["23505", "23514", "40001"].includes(error?.code ?? "")) {
      throw new ConflictException(error?.message ?? "Unable to cancel order");
    }

    if (error || !data) {
      throw new BadRequestException(error?.message ?? "Unable to cancel order");
    }

    try {
      if (typeof this.supabase?.broadcastEvent === "function") {
        const { data: orderData } = await this.db()
          .from("orders")
          .select("id,order_number,facility_id,customer_id")
          .eq("id", orderId)
          .maybeSingle();

        const payload = {
          eventType: "ORDER_STATUS_CHANGED",
          entityId: orderId,
          orderId,
          orderNumber: orderData?.order_number,
          status: "cancelled",
          facilityId: orderData?.facility_id,
          timestamp: new Date().toISOString(),
        };

        const broadcasts: Promise<any>[] = [
          this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`order:${orderId}`, "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("facility:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`customer:${profileId}`, "ORDER_STATUS_CHANGED", payload),
        ];

        if (orderData?.customer_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`customer:${orderData.customer_id}`, "ORDER_STATUS_CHANGED", payload),
          );
        }
        if (orderData?.facility_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`facility:${orderData.facility_id}`, "ORDER_STATUS_CHANGED", payload),
          );
        }

        await Promise.allSettled(broadcasts);
      }
    } catch {
      // Safe catch
    }

    return data;
  }

  async getById(profileId: string, id: string) {
    const { data: order, error } = await this.db()
      .from("orders")
      .select(
        "*,customers(profile_id),order_items(*,order_item_photos(*)),order_qr_codes(*),order_status_history(*)",
      )
      .eq("id", id)
      .maybeSingle();

    if (error || !order) {
      throw new NotFoundException("Order not found");
    }

    const isOwner = (order as any).customers?.profile_id === profileId;

    const { data: roleRows, error: rolesError } = await this.db()
      .from("profile_roles")
      .select("roles(code)")
      .eq("profile_id", profileId);

    if (rolesError) {
      throw new ForbiddenException("Unable to verify access");
    }

    const roleCodes = (roleRows ?? []).map((row: any) => row.roles?.code);

    const elevatedAccess = roleCodes.some((code: string) =>
      ["admin", "manager", "facility_employee"].includes(code),
    );

    let assignedDriver = false;

    if (!isOwner && !elevatedAccess && roleCodes.includes("driver")) {
      const { data: driver, error: driverError } = await this.db()
        .from("drivers")
        .select("id,is_active")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (!driverError && driver?.is_active) {
        const { data: assignment, error: assignmentError } = await this.db()
          .from("driver_assignments")
          .select("id")
          .eq("order_id", id)
          .eq("driver_id", driver.id)
          .limit(1)
          .maybeSingle();

        assignedDriver = !assignmentError && Boolean(assignment);
      }
    }

    if (!isOwner && !elevatedAccess && !assignedDriver) {
      throw new ForbiddenException("Not authorized to view this order");
    }

    return order;
  }

  async listMine(profileId: string, limit?: number, offset?: number) {
    const customerId = await this.customerId(profileId);

    let query = this.db()
      .from("orders")
      .select("*,order_items(*)")
      .eq("customer_id", customerId)
      .order("created_at", {
        ascending: false,
      });

    if (limit !== undefined && limit > 0) {
      const from = offset || 0;
      const to = from + limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }

  async history(profileId: string, id: string) {
    await this.getById(profileId, id);

    const { data, error } = await this.db()
      .from("order_status_history")
      .select("*")
      .eq("order_id", id)
      .order("created_at");

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }

  async activateClaimPeriod(orderId: string) {
    const { data: order, error } = await this.db()
      .from("orders")
      .select("id,current_status")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) {
      throw new NotFoundException("Order not found");
    }

    if (!["delivered", "claim_period_active"].includes(order.current_status)) {
      throw new BadRequestException(
        `Claim period cannot start while order is ${order.current_status}`,
      );
    }

    if (order.current_status === "claim_period_active") {
      return {
        orderId,
        orderStatus: "claim_period_active",
      };
    }

    const { error: statusError } = await this.db().rpc("change_order_status", {
      p_order_id: orderId,

      p_new_status: "claim_period_active",

      p_reason: "Delivery claim period activated",
    });

    if (statusError) {
      throw new BadRequestException(statusError.message);
    }

    return {
      orderId,
      orderStatus: "claim_period_active",
    };
  }

  async completeClaimPeriod(orderId: string) {
    const { error } = await this.db().rpc("complete_expired_claim_period", {
      p_order_id: orderId,
    });

    if (error?.code === "P0002") {
      throw new NotFoundException("Order not found");
    }

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      orderId,
      orderStatus: "completed",
    };
  }
}
