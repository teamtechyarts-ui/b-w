import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "crypto";

import { SupabaseService } from "../supabase/supabase.service";
import { LogisticsService } from "../logistics/logistics.service";
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  ProviderPayment,
  ProviderRefund,
} from "./providers/payment.provider";

type VerifyPaymentInput = {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

type ProviderPaymentRecord = {
  id: string;
  order_id: string;
  provider: string;
  provider_order_id: string;
  provider_payment_id: string | null;
  amount: number | string;
  currency: string;
  status: string;
};

type DatabaseError = {
  code?: string;
  message?: string;
};

type RefundClaim = {
  refundId: string;
  paymentOrderId: string;
  providerPaymentId: string;
  amount: number | string;
  currency: string;
  claimed: boolean;
  status: string;
  providerRefundId: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
    private readonly logistics?: LogisticsService,
  ) {}

  private async triggerPickupAssignment(orderId: string) {
    try {
      const { data: order } = await this.db()
        .from("orders")
        .select("id,order_number,current_status,facility_id,customer_id")
        .eq("id", orderId)
        .maybeSingle();

      const payload = {
        eventType: "ORDER_STATUS_CHANGED",
        entityId: orderId,
        orderId,
        orderNumber: order?.order_number,
        status: "confirmed",
        facilityId: order?.facility_id,
        jobType: "pickup",
        timestamp: new Date().toISOString(),
      };

      if (typeof this.supabase?.broadcastEvent === "function") {
        await Promise.allSettled([
          this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("driver:available", "JOB_AVAILABLE", payload),
          this.supabase.broadcastEvent("jobs:drivers", "JOB_AVAILABLE", payload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`order:${orderId}`, "ORDER_STATUS_CHANGED", payload),
          order?.customer_id
            ? this.supabase.broadcastEvent(`customer:${order.customer_id}`, "ORDER_STATUS_CHANGED", payload)
            : Promise.resolve(),
        ]);
      }
    } catch {
      // Safe catch
    }
  }

  private db() {
    return this.supabase.admin;
  }

  private providerName() {
    return "razorpay";
  }

  private throwDatabaseError(error: DatabaseError, fallback: string): never {
    if (error.code === "P0002") {
      throw new NotFoundException(error.message ?? fallback);
    }

    if (error.code === "42501") {
      throw new ForbiddenException(error.message ?? fallback);
    }

    if (["23505", "23514", "40001"].includes(error.code ?? "")) {
      throw new ConflictException(error.message ?? fallback);
    }

    throw new BadRequestException(error.message ?? fallback);
  }

  verify(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ) {
    const verified = this.provider.verifyCheckoutSignature({
      providerOrderId: razorpayOrderId,
      providerPaymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });

    if (!verified) {
      throw new BadRequestException("Invalid Razorpay signature");
    }

    return { verified: true };
  }

  private paymentResponse(paymentOrder: ProviderPaymentRecord) {
    return {
      orderId: paymentOrder.order_id,
      paymentOrderId: paymentOrder.id,
      razorpayOrderId: paymentOrder.provider_order_id,
      providerOrderId: paymentOrder.provider_order_id,
      amount: Math.round(Number(paymentOrder.amount) * 100),
      currency: paymentOrder.currency || "INR",
      keyId: this.provider.publicKeyId,
      provider: this.providerName(),
      paymentMethod: "razorpay",
    };
  }

  private async requireOwnedOrder(profileId: string, orderId: string) {
    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select(
        "id,total_amount,currency,customer_id,payment_method,current_status",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new NotFoundException("Order not found");
    }

    const { data: customer, error: customerError } = await this.db()
      .from("customers")
      .select("id")
      .eq("id", order.customer_id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (customerError) {
      throw new BadRequestException("Unable to validate order ownership");
    }

    if (!customer) {
      throw new ForbiddenException("Order belongs to another customer");
    }

    return order;
  }

  private async activePaymentOrder(orderId: string) {
    const { data, error } = await this.db()
      .from("payment_orders")
      .select("*")
      .eq("order_id", orderId)
      .in("status", ["created", "authorized", "paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data as ProviderPaymentRecord | null;
  }

  async createOrder(profileId: string, orderId: string) {
    const order = await this.requireOwnedOrder(profileId, orderId);

    if (
      order.payment_method !== "razorpay" ||
      order.current_status !== "pending_payment"
    ) {
      throw new ConflictException("Order is not awaiting a Razorpay payment");
    }

    if (this.provider.mode === "development") {
      throw new ServiceUnavailableException(
        "Online payment is temporarily unavailable. Please try again or choose Cash on Delivery.",
      );
    }

    const existing = await this.activePaymentOrder(orderId);
    if (existing) {
      return {
        ...this.paymentResponse(existing),
        reused: true,
      };
    }

    const amountPaise = Math.round(Number(order.total_amount) * 100);
    const currency = order.currency || "INR";

    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException("Order total is not payable");
    }

    const providerOrder = await this.provider.createOrder({
      amount: amountPaise,
      currency,
      receipt: `BW-${orderId.slice(0, 12)}`,
    });

    if (
      providerOrder.amount !== amountPaise ||
      providerOrder.currency !== currency
    ) {
      throw new ServiceUnavailableException(
        "Payment provider returned inconsistent order details",
      );
    }

    const { data, error: insertError } = await this.db()
      .from("payment_orders")
      .insert({
        order_id: orderId,
        provider: this.providerName(),
        provider_order_id: providerOrder.id,
        amount: Number(order.total_amount),
        currency,
        status: "created",
      })
      .select()
      .single();

    if (insertError || !data) {
      if (insertError?.code === "23505") {
        const concurrent = await this.activePaymentOrder(orderId);
        if (concurrent) {
          return {
            ...this.paymentResponse(concurrent),
            reused: true,
          };
        }
      }

      this.throwDatabaseError(
        insertError ?? {},
        "Unable to save payment order",
      );
    }

    return this.paymentResponse(data as ProviderPaymentRecord);
  }

  async getOrderPaymentSummary(profileId: string, orderId: string) {
    const order = await this.requireOwnedOrder(profileId, orderId);

    const { data: payment, error: paymentError } = await this.db()
      .from("payment_orders")
      .select(
        "id,order_id,provider,provider_order_id,amount,currency,status,paid_at,created_at,updated_at",
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) {
      throw new BadRequestException("Unable to load payment status");
    }

    if (!payment) {
      return {
        orderId,
        payment: null,
        refunds: [],
        refundEligibility: { eligible: false, remainingAmount: 0 },
      };
    }

    const { data: refunds, error: refundsError } = await this.db()
      .from("refund_requests")
      .select(
        "id,amount,reason,status,is_cancellation_refund,approved_at,processed_at,created_at",
      )
      .eq("payment_order_id", payment.id)
      .order("created_at", { ascending: false });

    if (refundsError) {
      throw new BadRequestException("Unable to load refund status");
    }

    const providerMatchesRuntime = payment.provider === this.providerName();
    const canResume =
      providerMatchesRuntime &&
      ["created", "authorized"].includes(payment.status);

    const refundRows = refunds ?? [];
    const committed = refundRows
      .filter((refund: any) =>
        [
          "requested",
          "under_review",
          "approved",
          "processing",
          "completed",
        ].includes(refund.status),
      )
      .reduce((total: number, refund: any) => total + Number(refund.amount), 0);
    const remainingAmount = Math.max(0, Number(payment.amount) - committed);
    const lifecycleEligible = ["cancelled", "claim_period_active"].includes(
      order.current_status,
    );
    const refundEligible =
      ["paid", "partially_refunded"].includes(payment.status) &&
      Boolean(payment.provider_order_id) &&
      lifecycleEligible &&
      remainingAmount > 0;

    return {
      orderId,
      payment: {
        paymentOrderId: payment.id,
        provider: payment.provider,
        providerOrderId: payment.provider_order_id,
        razorpayOrderId: payment.provider_order_id,
        amount: Math.round(Number(payment.amount) * 100),
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paid_at,
        createdAt: payment.created_at,
        updatedAt: payment.updated_at,
        canResume,
        keyId:
          canResume && payment.provider === "razorpay"
            ? this.provider.publicKeyId
            : null,
      },
      refunds: refundRows.map((refund: any) => ({
        refundRequestId: refund.id,
        amount: Number(refund.amount),
        reason: refund.reason,
        status: refund.status,
        cancellation: Boolean(refund.is_cancellation_refund),
        approvedAt: refund.approved_at,
        processedAt: refund.processed_at,
        createdAt: refund.created_at,
      })),
      refundEligibility: { eligible: refundEligible, remainingAmount },
    };
  }

  private async recordCapturedPayment(
    paymentOrder: ProviderPaymentRecord,
    payment: ProviderPayment,
    actorProfileId: string | null,
  ) {
    const { data, error } = await this.db().rpc(
      "record_captured_payment_atomic",
      {
        p_payment_order_id: paymentOrder.id,
        p_provider_payment_id: payment.id,
        p_provider_status: payment.status,
        p_provider_payload: {
          amount: payment.amount,
          currency: payment.currency,
          orderId: payment.orderId,
        },
        p_actor_profile_id: actorProfileId,
      },
    );

    if (error || !data) {
      this.throwDatabaseError(error ?? {}, "Unable to confirm payment");
    }

    return data as {
      orderId: string;
      orderStatus: string;
      duplicate: boolean;
    };
  }

  private async recordFailedPayment(
    paymentOrder: ProviderPaymentRecord,
    payment: ProviderPayment,
  ) {
    const { data, error } = await this.db().rpc(
      "record_failed_payment_atomic",
      {
        p_payment_order_id: paymentOrder.id,
        p_provider_payment_id: payment.id,
        p_provider_status: payment.status,
        p_provider_payload: {
          amount: payment.amount,
          currency: payment.currency,
          orderId: payment.orderId,
        },
      },
    );

    if (error || !data) {
      this.throwDatabaseError(error ?? {}, "Unable to record failed payment");
    }

    return data as {
      orderId: string;
      orderStatus: string;
      duplicate: boolean;
    };
  }

  private ensureMatchingPayment(
    paymentOrder: ProviderPaymentRecord,
    payment: ProviderPayment,
  ) {
    if (
      payment.orderId !== paymentOrder.provider_order_id ||
      Number(payment.amount) !==
        Math.round(Number(paymentOrder.amount) * 100) ||
      payment.currency !== paymentOrder.currency
    ) {
      throw new ConflictException(
        "Provider payment does not match the payment order",
      );
    }
  }

  private ensureMatchingRefund(
    expected: Pick<
      RefundClaim,
      "refundId" | "providerPaymentId" | "amount" | "currency"
    >,
    refund: ProviderRefund,
  ) {
    if (
      refund.paymentId !== expected.providerPaymentId ||
      Number(refund.amount) !== Math.round(Number(expected.amount) * 100) ||
      refund.currency !== expected.currency ||
      (refund.reference !== null && refund.reference !== expected.refundId) ||
      !["pending", "processed", "failed"].includes(refund.status)
    ) {
      throw new ConflictException(
        "Provider refund does not match the approved refund",
      );
    }
  }

  private async markRefundProviderUncertain(
    refundId: string,
    providerRefundId: string | null,
  ) {
    await this.db().rpc("mark_refund_provider_uncertain_atomic", {
      p_refund_id: refundId,
      p_provider_refund_id: providerRefundId,
    });
  }

  private async recordProviderRefund(
    refundId: string,
    providerRefund: ProviderRefund,
  ) {
    const { data, error } = await this.db().rpc(
      "record_provider_refund_atomic",
      {
        p_refund_id: refundId,
        p_provider_refund_id: providerRefund.id,
        p_provider_status: providerRefund.status,
        p_provider_payload: {
          paymentId: providerRefund.paymentId,
          amount: providerRefund.amount,
          currency: providerRefund.currency,
          status: providerRefund.status,
          reference: providerRefund.reference,
        },
      },
    );

    if (error || !data) {
      this.throwDatabaseError(error ?? {}, "Unable to record refund");
    }

    return data as {
      refundId: string;
      paymentOrderId: string;
      providerRefundId: string;
      status: string;
      duplicate: boolean;
    };
  }

  private async reconcileRefund(claim: RefundClaim) {
    const providerRefund = claim.providerRefundId
      ? await this.provider.fetchRefund(claim.providerRefundId)
      : await this.provider.findRefundByReference({
          providerPaymentId: claim.providerPaymentId,
          reference: claim.refundId,
        });

    if (!providerRefund) {
      throw new ConflictException("Refund provider reconciliation is pending");
    }

    this.ensureMatchingRefund(claim, providerRefund);
    return this.recordProviderRefund(claim.refundId, providerRefund);
  }

  async verifyPayment(profileId: string, body: VerifyPaymentInput) {
    if (this.provider.mode === "development") {
      throw new ServiceUnavailableException(
        "Razorpay credentials are not configured for this environment.",
      );
    }

    this.verify(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );

    const { data: paymentOrder, error } = await this.db()
      .from("payment_orders")
      .select("*")
      .eq("provider_order_id", body.razorpayOrderId)
      .maybeSingle();

    if (error || !paymentOrder) {
      throw new NotFoundException("Payment order not found");
    }

    await this.requireOwnedOrder(profileId, paymentOrder.order_id);

    if (
      paymentOrder.status === "paid" &&
      paymentOrder.provider_payment_id !== body.razorpayPaymentId
    ) {
      throw new ConflictException(
        "Payment order is already paid by another payment",
      );
    }

    const providerPayment = await this.provider.fetchPayment(
      body.razorpayPaymentId,
    );
    this.ensureMatchingPayment(paymentOrder, providerPayment);

    if (providerPayment.status !== "captured") {
      throw new ConflictException(
        "Provider payment is not in the captured state",
      );
    }

    const result = await this.recordCapturedPayment(
      paymentOrder,
      providerPayment,
      profileId,
    );

    if (result.orderStatus === "confirmed") {
      await this.triggerPickupAssignment(result.orderId);
    }

    return {
      verified: true,
      duplicate: result.duplicate,
      orderId: result.orderId,
      orderStatus: result.orderStatus,
      provider: this.providerName(),
    };
  }

  private verifyWebhookSignature(rawBody: Buffer, signature: string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      throw new ServiceUnavailableException(
        "Razorpay webhook is not configured",
      );
    }

    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException("Missing webhook body");
    }

    const expected = Buffer.from(
      createHmac("sha256", secret).update(rawBody).digest("hex"),
      "hex",
    );
    const actual =
      typeof signature === "string" && /^[a-f0-9]{64}$/i.test(signature)
        ? Buffer.from(signature, "hex")
        : Buffer.alloc(0);

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new BadRequestException("Invalid webhook signature");
    }
  }

  private async findPaymentOrder(providerOrderId: string) {
    const { data, error } = await this.db()
      .from("payment_orders")
      .select("*")
      .eq("provider_order_id", providerOrderId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data as ProviderPaymentRecord | null;
  }

  private async processPaymentWebhook(event: any) {
    const payment = event.payload?.payment?.entity;

    if (!payment?.id || !payment?.order_id) {
      throw new BadRequestException("Incomplete payment webhook");
    }

    if (!["captured", "failed"].includes(payment.status)) {
      throw new ConflictException("Webhook payment state is not supported");
    }

    const paymentOrder = await this.findPaymentOrder(payment.order_id);
    if (!paymentOrder) {
      return;
    }

    const normalized: ProviderPayment = {
      id: payment.id,
      orderId: payment.order_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
    };
    this.ensureMatchingPayment(paymentOrder, normalized);

    if (payment.status === "captured") {
      const result = await this.recordCapturedPayment(
        paymentOrder,
        normalized,
        null,
      );
      if (result.orderStatus === "confirmed") {
        await this.triggerPickupAssignment(result.orderId);
      }
    } else {
      await this.recordFailedPayment(paymentOrder, normalized);
    }
  }

  private async processRefundWebhook(event: any) {
    const refund = event.payload?.refund?.entity;
    if (
      !refund?.id ||
      !refund?.payment_id ||
      !Number.isSafeInteger(Number(refund.amount)) ||
      Number(refund.amount) <= 0 ||
      typeof refund.currency !== "string" ||
      !["pending", "processed", "failed"].includes(refund.status)
    ) {
      throw new BadRequestException("Incomplete refund webhook");
    }

    const reference = refund.notes?.bright_white_refund_id;
    const select =
      "id,payment_order_id,amount,provider_refund_id,payment_orders(provider_payment_id,currency)";
    const { data: byProviderId, error } = await this.db()
      .from("refund_requests")
      .select(select)
      .eq("provider_refund_id", refund.id)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }

    let refundRequest = byProviderId;
    if (
      !refundRequest &&
      typeof reference === "string" &&
      UUID_PATTERN.test(reference)
    ) {
      const { data: byReference, error: referenceError } = await this.db()
        .from("refund_requests")
        .select(select)
        .eq("id", reference)
        .maybeSingle();
      if (referenceError) {
        throw new BadRequestException(referenceError.message);
      }
      refundRequest = byReference;
    }

    if (!refundRequest) {
      return;
    }

    if (typeof reference === "string" && reference !== refundRequest.id) {
      throw new ConflictException("Provider refund reference does not match");
    }

    const relatedPayment = Array.isArray(refundRequest.payment_orders)
      ? refundRequest.payment_orders[0]
      : refundRequest.payment_orders;
    if (!relatedPayment?.provider_payment_id || !relatedPayment.currency) {
      throw new ConflictException("Refund payment context is incomplete");
    }

    const normalized: ProviderRefund = {
      id: refund.id,
      paymentId: refund.payment_id,
      amount: Number(refund.amount),
      currency: refund.currency,
      status: refund.status,
      reference: typeof reference === "string" ? reference : null,
    };
    this.ensureMatchingRefund(
      {
        refundId: refundRequest.id,
        providerPaymentId: relatedPayment.provider_payment_id,
        amount: refundRequest.amount,
        currency: relatedPayment.currency,
      },
      normalized,
    );
    await this.recordProviderRefund(refundRequest.id, normalized);
  }

  async webhook(rawBody: Buffer, signature: string, eventId?: string) {
    this.verifyWebhookSignature(rawBody, signature);

    let event: any;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid webhook JSON");
    }

    const externalEventId =
      eventId?.trim() || createHash("sha256").update(rawBody).digest("hex");

    const { data: registration, error: registrationError } =
      await this.db().rpc("register_payment_webhook_event_atomic", {
        p_provider: "razorpay",
        p_external_event_id: externalEventId,
        p_event_type: event.event || "unknown",
        p_payload: event,
      });

    if (registrationError || !registration) {
      this.throwDatabaseError(
        registrationError ?? {},
        "Unable to persist webhook event",
      );
    }

    if (!registration.claimed && registration.duplicate) {
      return {
        processed: true,
        duplicate: true,
      };
    }

    if (!registration.claimed) {
      throw new ServiceUnavailableException(
        "Webhook event processing is already in progress",
      );
    }

    try {
      if (
        event.event === "payment.captured" ||
        event.event === "payment.failed"
      ) {
        await this.processPaymentWebhook(event);
      } else if (
        event.event === "refund.processed" ||
        event.event === "refund.failed"
      ) {
        await this.processRefundWebhook(event);
      }

      const { error: finishError } = await this.db().rpc(
        "finish_payment_webhook_event_atomic",
        {
          p_event_id: registration.eventId,
          p_succeeded: true,
        },
      );
      if (finishError) {
        this.throwDatabaseError(finishError, "Unable to finish webhook event");
      }
    } catch (error) {
      await this.db().rpc("finish_payment_webhook_event_atomic", {
        p_event_id: registration.eventId,
        p_succeeded: false,
      });
      throw error;
    }

    return {
      processed: true,
      duplicate: false,
    };
  }

  async requestRefund(
    profileId: string,
    paymentOrderId: string,
    amount: number,
    reason: string,
  ) {
    const amountPaise = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException("Refund amount is invalid");
    }

    const { data, error } = await this.db().rpc("request_refund_atomic", {
      p_payment_order_id: paymentOrderId,
      p_requested_by: profileId,
      p_amount: amountPaise / 100,
      p_reason: reason,
    });

    if (error || !data) {
      this.throwDatabaseError(error ?? {}, "Unable to request refund");
    }

    return data;
  }

  async approveRefund(
    adminId: string,
    refundId: string,
    notes = "Approved by Admin",
  ) {
    if (this.provider.mode === "development") {
      throw new ServiceUnavailableException(
        "Razorpay credentials are not configured for this environment.",
      );
    }

    const { data: claim, error: claimError } = await this.db().rpc(
      "admin_claim_refund_approval_audited_atomic",
      {
        p_refund_id: refundId,
        p_admin_id: adminId,
        p_notes: notes,
      },
    );

    if (claimError || !claim) {
      this.throwDatabaseError(claimError ?? {}, "Unable to approve refund");
    }

    const refundClaim = claim as RefundClaim;

    if (!refundClaim.claimed) {
      if (
        refundClaim.providerRefundId &&
        ["completed", "failed"].includes(refundClaim.status)
      ) {
        return {
          refundId,
          providerRefundId: refundClaim.providerRefundId,
          status: refundClaim.status,
          duplicate: true,
          provider: this.providerName(),
        };
      }

      const reconciled = await this.reconcileRefund(refundClaim);
      return {
        refundId,
        providerRefundId: reconciled.providerRefundId,
        status: reconciled.status,
        duplicate: true,
        provider: this.providerName(),
      };
    }

    let providerRefund: ProviderRefund;
    try {
      providerRefund = await this.provider.refundPayment({
        providerPaymentId: refundClaim.providerPaymentId,
        amount: Math.round(Number(refundClaim.amount) * 100),
        currency: refundClaim.currency,
        reference: refundId,
      });
    } catch (error) {
      await this.markRefundProviderUncertain(refundId, null);
      throw error;
    }

    let recorded;
    try {
      this.ensureMatchingRefund(refundClaim, providerRefund);
      recorded = await this.recordProviderRefund(refundId, providerRefund);
    } catch (error) {
      await this.markRefundProviderUncertain(refundId, providerRefund.id);
      throw error;
    }

    return {
      refundId,
      providerRefundId: recorded.providerRefundId,
      status: recorded.status,
      duplicate: recorded.duplicate,
      provider: this.providerName(),
    };
  }
}
