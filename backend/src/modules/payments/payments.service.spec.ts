import { createHmac } from "crypto";

import { PaymentsService } from "./payments.service";
import { PaymentProvider } from "./providers/payment.provider";

describe("PaymentsService", () => {
  let service: PaymentsService;
  let provider: jest.Mocked<PaymentProvider>;

  const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  function createProviderMock(): jest.Mocked<PaymentProvider> {
    return {
      mode: "live",
      publicKeyId: "rzp_test_test",
      createOrder: jest.fn(),
      verifyCheckoutSignature: jest.fn(),
      fetchPayment: jest.fn(),
      refundPayment: jest.fn(),
      fetchRefund: jest.fn(),
      findRefundByReference: jest.fn(),
    };
  }

  beforeEach(() => {
    provider = createProviderMock();

    service = new PaymentsService(
      {
        admin: {},
      } as any,
      provider,
    );
  });

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    } else {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    jest.restoreAllMocks();
  });

  it("verifies a valid provider checkout signature", () => {
    provider.verifyCheckoutSignature.mockReturnValue(true);

    expect(service.verify("order_1", "pay_1", "a".repeat(64))).toEqual({
      verified: true,
    });

    expect(provider.verifyCheckoutSignature).toHaveBeenCalledWith({
      providerOrderId: "order_1",
      providerPaymentId: "pay_1",
      signature: "a".repeat(64),
    });
  });

  it.each([undefined, null, "invalid-signature", "é".repeat(64)])(
    "rejects signatures rejected by the payment provider",
    (signature) => {
      provider.verifyCheckoutSignature.mockReturnValue(false);

      expect(() =>
        service.verify("order_1", "pay_1", signature as any),
      ).toThrow("Invalid Razorpay signature");
    },
  );

  it("requires a matching captured provider payment before confirming the order", async () => {
    const paymentOrder = {
      id: "local-payment-1",
      order_id: "order-1",
      provider: "razorpay",
      provider_order_id: "order_provider1",
      provider_payment_id: null,
      amount: 25,
      currency: "INR",
      status: "created",
    };

    const query: any = {};

    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.maybeSingle = jest.fn().mockResolvedValue({
      data: paymentOrder,
      error: null,
    });

    provider.verifyCheckoutSignature.mockReturnValue(true);

    provider.fetchPayment.mockResolvedValue({
      id: "pay_provider1",
      orderId: "order_provider1",
      amount: 2500,
      currency: "INR",
      status: "captured",
    });

    const logistics = {
      assignBestDriver: jest.fn().mockResolvedValue({
        assignment: { id: "pickup-1" },
      }),
    };

    service = new PaymentsService(
      {
        admin: {
          from: jest.fn(() => query),
        },
      } as any,
      provider,
      logistics as any,
    );

    jest.spyOn(service as any, "requireOwnedOrder").mockResolvedValue({
      id: "order-1",
    });

    const recordCapturedPayment = jest
      .spyOn(service as any, "recordCapturedPayment")
      .mockResolvedValue({
        orderId: "order-1",
        orderStatus: "confirmed",
        duplicate: false,
      });

    await expect(
      service.verifyPayment("profile-1", {
        razorpayOrderId: "order_provider1",
        razorpayPaymentId: "pay_provider1",
        razorpaySignature: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      verified: true,
      duplicate: false,
      orderId: "order-1",
      orderStatus: "confirmed",
      provider: "razorpay",
    });

    expect(provider.fetchPayment).toHaveBeenCalledWith("pay_provider1");

    expect(recordCapturedPayment).toHaveBeenCalledWith(
      paymentOrder,
      {
        id: "pay_provider1",
        orderId: "order_provider1",
        amount: 2500,
        currency: "INR",
        status: "captured",
      },
      "profile-1",
    );
    expect(logistics.assignBestDriver).not.toHaveBeenCalled();
  });

  it("rejects a provider payment that does not match the payment order", async () => {
    const paymentOrder = {
      id: "local-payment-1",
      order_id: "order-1",
      provider: "razorpay",
      provider_order_id: "order_provider1",
      provider_payment_id: null,
      amount: 25,
      currency: "INR",
      status: "created",
    };

    const query: any = {};

    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.maybeSingle = jest.fn().mockResolvedValue({
      data: paymentOrder,
      error: null,
    });

    provider.verifyCheckoutSignature.mockReturnValue(true);

    provider.fetchPayment.mockResolvedValue({
      id: "pay_provider1",
      orderId: "another_order",
      amount: 2500,
      currency: "INR",
      status: "captured",
    });

    service = new PaymentsService(
      {
        admin: {
          from: jest.fn(() => query),
        },
      } as any,
      provider,
    );

    jest.spyOn(service as any, "requireOwnedOrder").mockResolvedValue({
      id: "order-1",
    });

    await expect(
      service.verifyPayment("profile-1", {
        razorpayOrderId: "order_provider1",
        razorpayPaymentId: "pay_provider1",
        razorpaySignature: "a".repeat(64),
      }),
    ).rejects.toThrow("Provider payment does not match the payment order");
  });

  it("persists the required webhook event IDs and marks the event processed", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";

    let call = 0;
    const inserted: any[] = [];
    const updates: any[] = [];

    const from = jest.fn(() => {
      call += 1;

      if (call === 1) {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (call === 2) {
        return {
          insert: (payload: any) => {
            inserted.push(payload);

            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: "event-1",
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }

      return {
        update: (payload: any) => {
          updates.push(payload);

          return {
            eq: async () => ({
              error: null,
            }),
          };
        },
      };
    });

    const rpc = jest.fn(async (name: string) => {
      if (name === "register_payment_webhook_event_atomic") {
        return {
          data: {
            claimed: true,
            eventId: "event-1",
          },
          error: null,
        };
      }

      if (name === "finish_payment_webhook_event_atomic") {
        return {
          data: {
            succeeded: true,
          },
          error: null,
        };
      }

      return {
        data: null,
        error: null,
      };
    });

    service = new PaymentsService(
      {
        admin: {
          from,
          rpc,
        },
      } as any,
      provider,
    );

    const payload = Buffer.from(
      JSON.stringify({
        event: "test.webhook",
        payload: {},
      }),
    );

    const signature = createHmac("sha256", "webhook-secret")
      .update(payload)
      .digest("hex");

    await expect(
      service.webhook(payload, signature, "event-provider-1"),
    ).resolves.toEqual({
      processed: true,
      duplicate: false,
    });

    expect(rpc).toHaveBeenCalledWith("register_payment_webhook_event_atomic", {
      p_provider: "razorpay",
      p_external_event_id: "event-provider-1",
      p_event_type: "test.webhook",
      p_payload: {
        event: "test.webhook",
        payload: {},
      },
    });

    expect(rpc).toHaveBeenCalledWith("finish_payment_webhook_event_atomic", {
      p_event_id: "event-1",
      p_succeeded: true,
    });
  });

  it("rejects webhook verification when its secret is missing", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const payload = Buffer.from("{}");

    const signature = createHmac("sha256", "").update(payload).digest("hex");

    await expect(service.webhook(payload, signature)).rejects.toThrow(
      "Razorpay webhook is not configured",
    );
  });

  it("rejects malformed webhook signatures before database access", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
    const rpc = jest.fn();
    service = new PaymentsService({ admin: { rpc } } as any, provider);

    await expect(
      service.webhook(Buffer.from("{}"), "not-a-signature"),
    ).rejects.toThrow("Invalid webhook signature");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a retryable error while another webhook worker holds the lease", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
    const rpc = jest.fn().mockResolvedValue({
      data: {
        claimed: false,
        duplicate: false,
        eventId: "event-1",
        processingStatus: "processing",
      },
      error: null,
    });
    service = new PaymentsService({ admin: { rpc } } as any, provider);
    const payload = Buffer.from(
      JSON.stringify({ event: "test.webhook", payload: {} }),
    );
    const signature = createHmac("sha256", "webhook-secret")
      .update(payload)
      .digest("hex");

    await expect(
      service.webhook(payload, signature, "event-1"),
    ).rejects.toThrow("Webhook event processing is already in progress");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reconciles an uncertain refund by its provider reference", async () => {
    const refundId = "00000000-0000-4000-8000-000000000001";
    const claim = {
      refundId,
      paymentOrderId: "payment-order-1",
      providerPaymentId: "pay_live1",
      amount: 15,
      currency: "INR",
      claimed: false,
      status: "processing",
      providerRefundId: null,
    };
    const providerRefund = {
      id: "rfnd_live1",
      paymentId: "pay_live1",
      amount: 1_500,
      currency: "INR",
      status: "processed",
      reference: refundId,
    };
    const rpc = jest.fn(async (name: string) => {
      if (name === "admin_claim_refund_approval_audited_atomic") {
        return { data: claim, error: null };
      }
      if (name === "record_provider_refund_atomic") {
        return {
          data: {
            refundId,
            paymentOrderId: "payment-order-1",
            providerRefundId: providerRefund.id,
            status: "completed",
            duplicate: false,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    provider.findRefundByReference.mockResolvedValue(providerRefund);
    service = new PaymentsService({ admin: { rpc } } as any, provider);

    await expect(service.approveRefund("admin-1", refundId)).resolves.toEqual({
      refundId,
      providerRefundId: providerRefund.id,
      status: "completed",
      duplicate: true,
      provider: "razorpay",
    });
    expect(provider.findRefundByReference).toHaveBeenCalledWith({
      providerPaymentId: "pay_live1",
      reference: refundId,
    });
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it("rejects a mismatched provider refund and preserves its reference for reconciliation", async () => {
    const refundId = "00000000-0000-4000-8000-000000000001";
    const rpc = jest.fn(async (name: string) => {
      if (name === "admin_claim_refund_approval_audited_atomic") {
        return {
          data: {
            refundId,
            paymentOrderId: "payment-order-1",
            providerPaymentId: "pay_live1",
            amount: 15,
            currency: "INR",
            claimed: true,
            status: "approved",
            providerRefundId: null,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    provider.refundPayment.mockResolvedValue({
      id: "rfnd_wrong",
      paymentId: "pay_live1",
      amount: 1_400,
      currency: "INR",
      status: "processed",
      reference: refundId,
    });
    service = new PaymentsService({ admin: { rpc } } as any, provider);

    await expect(service.approveRefund("admin-1", refundId)).rejects.toThrow(
      "Provider refund does not match the approved refund",
    );
    expect(rpc).toHaveBeenCalledWith("mark_refund_provider_uncertain_atomic", {
      p_refund_id: refundId,
      p_provider_refund_id: "rfnd_wrong",
    });
    expect(
      rpc.mock.calls.some(([name]) => name === "record_provider_refund_atomic"),
    ).toBe(false);
  });

  it("preserves a successful provider refund when database recording fails", async () => {
    const refundId = "00000000-0000-4000-8000-000000000001";
    const rpc = jest.fn(async (name: string) => {
      if (name === "admin_claim_refund_approval_audited_atomic") {
        return {
          data: {
            refundId,
            paymentOrderId: "payment-order-1",
            providerPaymentId: "pay_live1",
            amount: 15,
            currency: "INR",
            claimed: true,
            status: "approved",
            providerRefundId: null,
          },
          error: null,
        };
      }
      if (name === "record_provider_refund_atomic") {
        return {
          data: null,
          error: { code: "40001", message: "Retry database operation" },
        };
      }
      return { data: null, error: null };
    });
    provider.refundPayment.mockResolvedValue({
      id: "rfnd_live1",
      paymentId: "pay_live1",
      amount: 1_500,
      currency: "INR",
      status: "processed",
      reference: refundId,
    });
    service = new PaymentsService({ admin: { rpc } } as any, provider);

    await expect(service.approveRefund("admin-1", refundId)).rejects.toThrow(
      "Retry database operation",
    );
    expect(rpc).toHaveBeenCalledWith("mark_refund_provider_uncertain_atomic", {
      p_refund_id: refundId,
      p_provider_refund_id: "rfnd_live1",
    });
  });
});
