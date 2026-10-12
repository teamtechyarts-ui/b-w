import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { OrdersService, invalidateCustomerCache, getCustomerCacheSize } from "./orders.service";
import { validate } from "class-validator";
import { CreateOrderDto } from "./dto/create-order.dto";

it("requires an idempotency key at the customer order API boundary", async () => {
  const dto = new CreateOrderDto();
  const errors = await validate(dto);
  expect(errors.some((error) => error.property === "idempotencyKey")).toBe(
    true,
  );
});

describe("OrdersService checkout rewards", () => {
  function fixture(minimumOrderAmount = 0, servicePrice = 200, addressOverride?: any, facilitiesOverride?: any) {
    const from = jest.fn((table: string) => {
      const results: Record<string, any> = {
        customers: { data: { id: "customer-1" }, error: null },
        customer_addresses: {
          data: addressOverride !== undefined ? addressOverride : { id: "address-1", postal_code: "500068", address_line1: "123 Street", label: "Home" },
          error: null,
        },
        facilities: {
          data: facilitiesOverride !== undefined ? facilitiesOverride : [
            {
              id: "facility-1",
              name: "Central Hub",
              is_active: true,
            },
          ],
          error: null,
        },
        facility_service_pincodes: {
          data: [{ facility_id: "facility-1", pincode: "500068" }],
          error: null,
        },
        services: { data: { id: "service-1", is_active: true }, error: null },
        service_prices: { data: [{ price: servicePrice }], error: null },
        checkout_pricing_policies: {
          data: {
            pickup_delivery_fee: 50,
            free_delivery_threshold: 500,
            gst_rate_percent: 5,
            minimum_order_amount: minimumOrderAmount,
          },
          error: null,
        },
        admin_growth_settings: {
          data: {
            loyalty_points_per_rupee: 10,
            loyalty_minimum_redemption_rupees: 100,
          },
          error: null,
        },
      };
      const value = results[table];
      const chain: any = {};
      for (const method of [
        "select",
        "eq",
        "lte",
        "or",
        "order",
        "limit",
        "is",
        "not",
        "in",
      ])
        chain[method] = jest.fn(() => chain);
      chain.maybeSingle = jest.fn().mockResolvedValue(value);
      chain.single = jest.fn().mockResolvedValue(value);
      chain.then = (resolve: any) => Promise.resolve(value).then(resolve);
      return chain;
    });
    const rpc = jest.fn((proc: string) => {
      if (proc === "check_location_serviceability") {
        return Promise.resolve({ data: null, error: { message: "RPC not available" } });
      }
      return Promise.resolve({ data: "order-1", error: null });
    });
    const service = new OrdersService(
      { admin: { from, rpc } } as any,
      {
        applyCoupon: jest
          .fn()
          .mockResolvedValue({ offerId: "offer-1", discount: 10 }),
      } as any,
    );
    jest.spyOn(service, "getById").mockResolvedValue({ id: "order-1" } as any);
    const dto: any = {
      pickupAddressId: "address-1",
      deliveryAddressId: "address-1",
      pickupScheduledAt: new Date(Date.now() + 86400000).toISOString(),
      pickupSlotLabel: "Morning",
      paymentMethod: "cash_on_delivery",
      termsAccepted: true,
      items: [{ serviceId: "service-1", itemName: "Shirt", quantity: 1 }],
      couponCode: "SAVE10",
      loyaltyPointsToRedeem: 1000,
    };
    return { service, from, rpc, dto };
  }
  it("uses one atomic local procedure for checkout points and the priced order", async () => {
    const f = fixture();
    await expect(f.service.create("profile-1", f.dto)).resolves.toMatchObject({
      id: "order-1",
    });
    expect(f.rpc).toHaveBeenCalledWith(
      "create_customer_order_with_rewards_atomic",
      expect.objectContaining({
        p_customer_id: "customer-1",
        p_points: 1000,
        p_order: expect.objectContaining({
          facility_id: "facility-1",
          discount_amount: 110,
          loyalty_discount_amount: 100,
          total_amount: 147,
        }),
      }),
    );
    expect(f.from).not.toHaveBeenCalledWith("orders");
  });
  it("rejects points that exceed the remaining service price", async () => {
    const f = fixture();
    f.dto.loyaltyPointsToRedeem = 9001;
    await expect(f.service.create("profile-1", f.dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.rpc).not.toHaveBeenCalledWith("create_customer_order_with_rewards_atomic", expect.anything());
  });
  it("converts 2,000 points to ₹200 on the server", async () => {
    const f = fixture(0, 300);
    f.dto.loyaltyPointsToRedeem = 2000;
    await expect(f.service.create("profile-1", f.dto)).resolves.toMatchObject({
      id: "order-1",
    });
    expect(f.rpc).toHaveBeenCalledWith(
      "create_customer_order_with_rewards_atomic",
      expect.objectContaining({
        p_points: 2000,
        p_order: expect.objectContaining({ loyalty_discount_amount: 200 }),
      }),
    );
  });
  it("rejects redemptions below the 1,000 point minimum", async () => {
    const f = fixture();
    f.dto.loyaltyPointsToRedeem = 950;
    await expect(f.service.create("profile-1", f.dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.rpc).not.toHaveBeenCalledWith("create_customer_order_with_rewards_atomic", expect.anything());
  });
  it("creates ordinary orders through the same atomic procedure", async () => {
    const f = fixture();
    delete f.dto.loyaltyPointsToRedeem;
    await expect(f.service.create("profile-1", f.dto)).resolves.toMatchObject({
      id: "order-1",
    });
    expect(f.rpc).toHaveBeenCalledWith(
      "create_customer_order_with_rewards_atomic",
      expect.objectContaining({ p_points: 0 }),
    );
    expect(f.from).not.toHaveBeenCalledWith("orders");
  });
  it("blocks order creation below the server minimum order amount", async () => {
    const f = fixture(250);
    await expect(f.service.create("profile-1", f.dto)).rejects.toThrow(
      "minimum order",
    );
    expect(f.rpc).not.toHaveBeenCalledWith("create_customer_order_with_rewards_atomic", expect.anything());
  });
});

describe("OrdersService order retry", () => {
  const dto: any = { idempotencyKey: "65dcbe0e-352c-496b-bf19-647aee9d7c2f" };
  function fixture(hash: string) {
    const customer = { data: { id: "customer-1" }, error: null };
    const prior = {
      data: { id: "order-1", idempotency_request_hash: hash },
      error: null,
    };
    const from = jest.fn((table: string) => {
      const result = table === "customers" ? customer : prior;
      const query: any = {};
      for (const method of ["select", "eq"])
        query[method] = jest.fn(() => query);
      query.maybeSingle = jest.fn().mockResolvedValue(result);
      return query;
    });
    const service = new OrdersService({ admin: { from } } as any);
    jest.spyOn(service, "getById").mockResolvedValue({ id: "order-1" } as any);
    return { service, from };
  }

  it("returns the original customer order for an identical retry", async () => {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256")
      .update(JSON.stringify({ ...dto, idempotencyKey: undefined }))
      .digest("hex");
    const { service, from } = fixture(hash);
    await expect(service.create("profile-1", dto)).resolves.toEqual({
      id: "order-1",
    });
    expect(from).not.toHaveBeenCalledWith("order_items");
  });

  it("rejects reuse of a key for a different checkout", async () => {
    const { service } = fixture("different-hash");
    await expect(service.create("profile-1", dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("OrdersService claim period", () => {
  function fixture(
    result: {
      data: unknown;
      error: null | {
        code: string;
        message: string;
      };
    } = {
      data: {
        orderId: "order-1",
        orderStatus: "completed",
      },
      error: null,
    },
  ) {
    const rpc = jest.fn().mockResolvedValue(result);
    return {
      service: new OrdersService({
        admin: {
          rpc,
        },
      } as any),
      rpc,
    };
  }

  it("completes an expired claim period through the C2 RPC", async () => {
    const f = fixture();

    await expect(f.service.completeClaimPeriod("order-1")).resolves.toEqual({
      orderId: "order-1",
      orderStatus: "completed",
    });
    expect(f.rpc).toHaveBeenCalledWith("complete_expired_claim_period", {
      p_order_id: "order-1",
    });
  });

  it("returns a bad request when the database rejects completion", async () => {
    const f = fixture({
      data: null,
      error: {
        code: "23514",
        message: "The delivery claim period is still active",
      },
    });

    await expect(
      f.service.completeClaimPeriod("order-1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns not found when the database cannot find the order", async () => {
    const f = fixture({
      data: null,
      error: {
        code: "P0002",
        message: "Order order-1 not found",
      },
    });

    await expect(
      f.service.completeClaimPeriod("order-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("OrdersService driver order access", () => {
  function fluentResult(data: any, error: any = null) {
    const result = { data, error };
    const query: any = {};
    for (const method of ["select", "eq", "limit"]) {
      query[method] = jest.fn(() => query);
    }
    query.maybeSingle = jest.fn().mockResolvedValue(result);
    query.then = (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return query;
  }

  function fixture(assignment: { id: string } | null) {
    const order = {
      id: "order-1",
      customers: { profile_id: "customer-profile-1" },
    };
    const tables: Record<string, any> = {
      orders: fluentResult(order),
      profile_roles: fluentResult([{ roles: { code: "driver" } }]),
      drivers: fluentResult({ id: "driver-1", is_active: true }),
      driver_assignments: fluentResult(assignment),
    };
    return {
      service: new OrdersService({
        admin: {
          from: jest.fn((table: string) => tables[table]),
        },
      } as any),
      order,
    };
  }

  it("allows a driver assigned to the requested order", async () => {
    const f = fixture({ id: "assignment-1" });

    await expect(
      f.service.getById("driver-profile-1", "order-1"),
    ).resolves.toEqual(f.order);
  });

  it("does not let an unrelated driver view the order", async () => {
    const f = fixture(null);

    await expect(
      f.service.getById("driver-profile-1", "order-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("OrdersService customer cancellation", () => {
  function fixture(result: {
    data: unknown;
    error: null | {
      code: string;
      message: string;
    };
  }) {
    const rpc = jest.fn().mockResolvedValue(result);
    return {
      service: new OrdersService({ admin: { rpc } } as any),
      rpc,
    };
  }

  it("delegates cancellation to the atomic C2 database workflow", async () => {
    const result = {
      orderId: "order-1",
      orderStatus: "cancelled",
      duplicate: false,
      refundRequestId: "refund-1",
      refundCreated: true,
    };
    const f = fixture({ data: result, error: null });

    await expect(
      f.service.cancel("profile-1", "order-1", "Pickup is no longer needed"),
    ).resolves.toEqual(result);
    expect(f.rpc).toHaveBeenCalledWith("cancel_customer_order_atomic", {
      p_order_id: "order-1",
      p_profile_id: "profile-1",
      p_reason: "Pickup is no longer needed",
    });
  });

  it.each([
    ["P0002", NotFoundException],
    ["42501", ForbiddenException],
    ["23514", ConflictException],
  ])("maps database error %s without bypassing the RPC", async (code, type) => {
    const f = fixture({
      data: null,
      error: {
        code,
        message: "Cancellation rejected",
      },
    });

    await expect(
      f.service.cancel("profile-1", "order-1", "Pickup is no longer needed"),
    ).rejects.toBeInstanceOf(type);
  });
});

describe("OrdersService pincode-based laundry serviceability", () => {
  function fixtureWithPincodes(pincodeMappings: any[], facilities: any[], address?: any) {
    const from = jest.fn((table: string) => {
      let currentData: any = null;
      if (table === "customers") currentData = { id: "customer-1" };
      else if (table === "customer_addresses")
        currentData = address !== undefined ? address : { id: "addr-1", postal_code: "500068", address_line1: "Road 1" };
      else if (table === "facility_service_pincodes") currentData = [...pincodeMappings];
      else if (table === "facilities") currentData = [...facilities];
      else if (table === "services") currentData = { id: "service-1", is_active: true };
      else if (table === "service_prices") currentData = [{ price: 200 }];
      else if (table === "orders") currentData = null;
      else if (table === "admin_growth_settings")
        currentData = { loyalty_points_per_rupee: 10, loyalty_minimum_redemption_rupees: 100 };
      else if (table === "checkout_pricing_policies")
        currentData = {
          pickup_delivery_fee: 50,
          free_delivery_threshold: 500,
          gst_rate_percent: 5,
          minimum_order_amount: 0,
        };

      const chain: any = {};
      chain.select = jest.fn(() => chain);
      chain.order = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.is = jest.fn(() => chain);
      chain.not = jest.fn(() => chain);
      chain.lte = jest.fn(() => chain);
      chain.or = jest.fn(() => chain);
      chain.eq = jest.fn((col: string, val: any) => {
        if (table === "facility_service_pincodes" && col === "pincode" && Array.isArray(currentData)) {
          currentData = currentData.filter((r: any) => r.pincode === val);
        } else if (table === "facilities" && col === "is_active" && Array.isArray(currentData)) {
          currentData = currentData.filter((r: any) => r.is_active === val);
        }
        return chain;
      });
      chain.in = jest.fn((col: string, vals: any[]) => {
        if (table === "facilities" && col === "id" && Array.isArray(currentData)) {
          currentData = currentData.filter((r: any) => vals.includes(r.id));
        }
        return chain;
      });
      chain.maybeSingle = jest.fn(() => Promise.resolve({ data: currentData, error: null }));
      chain.single = jest.fn(() => Promise.resolve({ data: currentData, error: null }));
      chain.then = (resolve: any) => Promise.resolve({ data: currentData, error: null }).then(resolve);
      return chain;
    });
    const rpc = jest.fn().mockResolvedValue({ data: "order-1", error: null });
    const service = new OrdersService({ admin: { from, rpc } } as any);
    jest.spyOn(service, "getById").mockResolvedValue({ id: "order-1", facility_id: "fac-1" } as any);
    return { service, from, rpc };
  }

  it("1. Valid pincode + active facility -> serviceable", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central Laundry", is_active: true }],
      { id: "addr-1", postal_code: "500068" },
    );

    const result = await service.checkServiceability("profile-1", "addr-1");
    expect(result.serviceable).toBe(true);
    expect(result.facilityId).toBe("fac-1");
    expect(result.facilityName).toBe("Central Laundry");
    expect(result.pincode).toBe("500068");
  });

  it("2. Valid pincode + no matching facility -> not serviceable", async () => {
    const { service } = fixtureWithPincodes(
      [],
      [{ id: "fac-1", name: "Central Laundry", is_active: true }],
      { id: "addr-1", postal_code: "500099" },
    );

    const result = await service.checkServiceability("profile-1", "addr-1");
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe("OUTSIDE_SERVICE_AREA");
    expect(result.message).toContain("do not provide pickup and delivery service in your pincode");
  });

  it("3. Facility inactive + matching pincode -> not serviceable", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-inactive", pincode: "500068" }],
      [], // No active facilities returned
      { id: "addr-1", postal_code: "500068" },
    );

    const result = await service.checkServiceability("profile-1", "addr-1");
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe("OUTSIDE_SERVICE_AREA");
  });

  it("4. Two active facilities serve same pincode -> deterministic selection by name ASC", async () => {
    const { service } = fixtureWithPincodes(
      [
        { facility_id: "fac-z", pincode: "500068" },
        { facility_id: "fac-a", pincode: "500068" },
      ],
      [
        { id: "fac-z", name: "Zebra Hub", is_active: true },
        { id: "fac-a", name: "Alpha Hub", is_active: true },
      ],
      { id: "addr-1", postal_code: "500068" },
    );

    const result = await service.checkServiceability("profile-1", "addr-1");
    expect(result.serviceable).toBe(true);
    expect(result.facilityId).toBe("fac-a");
    expect(result.facilityName).toBe("Alpha Hub");
  });

  it("6. Invalid pincode: 50068 (5 digits) -> rejected", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      { id: "addr-short", postal_code: "50068" },
    );

    const result = await service.checkServiceability("profile-1", "addr-short");
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe("INVALID_PINCODE");
    expect(result.message).toContain("valid 6-digit pincode");
  });

  it("7. Invalid pincode: 5000680 (7 digits) -> rejected", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      { id: "addr-long", postal_code: "5000680" },
    );

    const result = await service.checkServiceability("profile-1", "addr-long");
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe("INVALID_PINCODE");
  });

  it("8. Non-numeric pincode: 50A068 -> rejected", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      { id: "addr-alpha", postal_code: "50A068" },
    );

    const result = await service.checkServiceability("profile-1", "addr-alpha");
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe("INVALID_PINCODE");
  });

  it("9. Missing pincode -> rejected", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      { id: "addr-null", postal_code: null },
    );

    const result = await service.checkServiceability("profile-1", "addr-null");
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe("INVALID_PINCODE");
  });

  it("10. Customer tries to use another customer's address -> 400 BadRequestException", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      null, // Address not found
    );

    await expect(service.checkServiceability("profile-1", "addr-other")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("11 & 12. Address changes between serviceable and unserviceable pincodes", async () => {
    const { service: serviceableService } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      { id: "addr-1", postal_code: "500068" },
    );
    const res1 = await serviceableService.checkServiceability("profile-1", "addr-1");
    expect(res1.serviceable).toBe(true);

    const { service: unserviceableService } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central", is_active: true }],
      { id: "addr-2", postal_code: "500099" },
    );
    const res2 = await unserviceableService.checkServiceability("profile-1", "addr-2");
    expect(res2.serviceable).toBe(false);
  });

  it("13. POST /v1/orders with serviceable pincode -> order succeeds and assigns facility_id", async () => {
    const { service, rpc } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central Hub", is_active: true }],
      { id: "addr-1", postal_code: "500068" },
    );

    const dto: any = {
      pickupAddressId: "addr-1",
      deliveryAddressId: "addr-1",
      pickupScheduledAt: new Date(Date.now() + 86400000).toISOString(),
      pickupSlotLabel: "Morning",
      paymentMethod: "cash_on_delivery",
      termsAccepted: true,
      items: [{ serviceId: "service-1", itemName: "Shirt", quantity: 1 }],
      idempotencyKey: "test-key-pincode-order",
    };

    const order = await service.create("profile-1", dto);
    expect(order).toBeDefined();
    expect(rpc).toHaveBeenCalledWith(
      "create_customer_order_with_rewards_atomic",
      expect.objectContaining({
        p_order: expect.objectContaining({
          facility_id: "fac-1",
        }),
      }),
    );
  });

  it("14. POST /v1/orders with non-serviceable pincode -> order rejected with 400", async () => {
    const { service } = fixtureWithPincodes(
      [],
      [{ id: "fac-1", name: "Central Hub", is_active: true }],
      { id: "addr-1", postal_code: "500099" },
    );

    const dto: any = {
      pickupAddressId: "addr-1",
      deliveryAddressId: "addr-1",
      pickupScheduledAt: new Date(Date.now() + 86400000).toISOString(),
      pickupSlotLabel: "Morning",
      paymentMethod: "cash_on_delivery",
      termsAccepted: true,
      items: [{ serviceId: "service-1", itemName: "Shirt", quantity: 1 }],
      idempotencyKey: "test-key-pincode-fail",
    };

    await expect(service.create("profile-1", dto)).rejects.toThrow(
      "do not provide pickup and delivery service in your pincode",
    );
  });

  it("17. Latitude/longitude missing -> order allowed when pincode is valid and serviceable", async () => {
    const { service, rpc } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central Hub", is_active: true, latitude: null, longitude: null }],
      { id: "addr-no-gps", postal_code: "500068", latitude: null, longitude: null },
    );

    const dto: any = {
      pickupAddressId: "addr-no-gps",
      deliveryAddressId: "addr-no-gps",
      pickupScheduledAt: new Date(Date.now() + 86400000).toISOString(),
      pickupSlotLabel: "Morning",
      paymentMethod: "cash_on_delivery",
      termsAccepted: true,
      items: [{ serviceId: "service-1", itemName: "Shirt", quantity: 1 }],
      idempotencyKey: "test-key-no-gps",
    };

    const order = await service.create("profile-1", dto);
    expect(order).toBeDefined();
    expect(rpc).toHaveBeenCalledWith(
      "create_customer_order_with_rewards_atomic",
      expect.objectContaining({
        p_order: expect.objectContaining({
          facility_id: "fac-1",
        }),
      }),
    );
  });

  it("18. Latitude/longitude present -> does not affect pincode serviceability", async () => {
    const { service } = fixtureWithPincodes(
      [{ facility_id: "fac-1", pincode: "500068" }],
      [{ id: "fac-1", name: "Central Hub", is_active: true, latitude: 12.34, longitude: 56.78 }],
      { id: "addr-with-gps", postal_code: "500068", latitude: 98.76, longitude: 54.32 },
    );

    const result = await service.checkServiceability("profile-1", "addr-with-gps");
    expect(result.serviceable).toBe(true);
    expect(result.facilityId).toBe("fac-1");
  });
});

describe("OrdersService customerIdCache and isolation", () => {
  beforeEach(() => {
    invalidateCustomerCache();
  });

  it("caches customer ID and reuses it on subsequent calls", async () => {
    const fromMock = jest.fn((table: string) => {
      if (table === "customers") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: "cust-123" }, error: null }),
        };
      }
      if (table === "customer_addresses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: "addr-1", postal_code: "500068" },
            error: null,
          }),
        };
      }
      if (table === "facility_service_pincodes") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ facility_id: "fac-1", pincode: "500068" }],
            error: null,
          }),
        };
      }
      if (table === "facilities") {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ id: "fac-1", name: "Central", is_active: true }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const supabaseMock: any = { admin: { from: fromMock } };
    const service = new OrdersService(supabaseMock);

    // First call: resolves customer ID from database
    await service.checkServiceability("profile-user-a", "addr-1");
    expect(fromMock).toHaveBeenCalledWith("customers");
    expect(getCustomerCacheSize()).toBe(1);

    // Second call: served from in-memory cache
    fromMock.mockClear();
    await service.checkServiceability("profile-user-a", "addr-1");
    expect(fromMock).not.toHaveBeenCalledWith("customers");

    // Invalidation clears specific profile
    invalidateCustomerCache("profile-user-a");
    expect(getCustomerCacheSize()).toBe(0);

    // Call after invalidation queries DB again
    await service.checkServiceability("profile-user-a", "addr-1");
    expect(fromMock).toHaveBeenCalledWith("customers");
  });

  it("enforces tenant/customer isolation in listMine", async () => {
    let capturedCustomerId: string | null = null;
    const fromMock = jest.fn((table: string) => {
      if (table === "customers") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: "customer-owned-id" }, error: null }),
        };
      }
      if (table === "orders") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn((col: string, val: string) => {
            if (col === "customer_id") capturedCustomerId = val;
            return {
              order: jest.fn().mockResolvedValue({
                data: [{ id: "order-1", customer_id: "customer-owned-id" }],
                error: null,
              }),
            };
          }),
        };
      }
      return {};
    });

    const supabaseMock: any = { admin: { from: fromMock } };
    const service = new OrdersService(supabaseMock);

    const orders = await service.listMine("profile-user-b");
    expect(orders).toHaveLength(1);
    expect(capturedCustomerId).toBe("customer-owned-id");
  });
});


