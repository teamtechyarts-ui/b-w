import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { createHmac } from "crypto";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { SupabaseService } from "../src/modules/supabase/supabase.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PaymentsService } from "../src/modules/payments/payments.service";
import { AnalyticsService } from "../src/modules/analytics/analytics.service";
import { AdminManagementService } from "../src/modules/admin-management/admin-management.service";
import { AdminIssuesService } from "../src/modules/admin-management/admin-issues.service";
import { AdminGrowthService } from "../src/modules/admin-management/admin-growth.service";
import { AdminFacilityOversightService } from "../src/modules/admin-management/admin-facility-oversight.service";
import { AnalyticsReportsService } from "../src/modules/analytics/analytics-reports.service";
import { StaffService } from "../src/modules/staff/staff.service";

// Keep HTTP routing, validation and guards real; never contact external services.
describe("Backend HTTP integration", () => {
  let app: NestFastifyApplication;
  let roles = ["customer"];
  const from = jest.fn();
  const rpc = jest.fn();
  const getUser = jest.fn();
  const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const originalKeyId = process.env.RAZORPAY_KEY_ID;
  const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const originalMapsKey = process.env.GOOGLE_MAPS_SERVER_KEY;

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = "e2e-test-key-id";
    process.env.RAZORPAY_KEY_SECRET = "e2e-test-key-secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "e2e-webhook-secret";
    process.env.GOOGLE_MAPS_SERVER_KEY = "e2e-maps-key";

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({ admin: { from, rpc }, client: {}, getUser })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { rawBody: true },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (originalSecret !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    if (originalKeyId !== undefined) process.env.RAZORPAY_KEY_ID = originalKeyId;
    else delete process.env.RAZORPAY_KEY_ID;
    if (originalKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
    else delete process.env.RAZORPAY_KEY_SECRET;
    if (originalMapsKey !== undefined) process.env.GOOGLE_MAPS_SERVER_KEY = originalMapsKey;
    else delete process.env.GOOGLE_MAPS_SERVER_KEY;

    if (app) await app.close();
  });

  beforeEach(() => {
    roles = ["customer"];
    from.mockReset();
    rpc.mockReset();
    getUser.mockReset().mockResolvedValue({ id: "profile-1" });

    rpc.mockImplementation(async (name: string) => {
      if (name === "register_payment_webhook_event_atomic") {
        return {
          data: {
            claimed: false,
            duplicate: true,
            eventId: "existing-event",
            processingStatus: "processed",
          },
          error: null,
        };
      }

      return {
        data: null,
        error: null,
      };
    });
    from.mockImplementation((table: string) => {
      if (table === "profiles")
        return {
          select: () => ({
            limit: () => ({ abortSignal: async () => ({ error: null }) }),
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "profile-1", is_active: true },
                error: null,
              }),
            }),
          }),
        };
      if (table === "profile_roles")
        return {
          select: () => ({
            eq: async () => ({
              data: roles.map((code) => ({
                roles: { code, role_permissions: [] },
              })),
              error: null,
            }),
          }),
        };
      if (table === "drivers")
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "driver-1", is_active: true }, error: null,
        }) }) }) };
      if (table === "facility_employees") {
        const query: any = {};
        query.eq = () => query;
        query.maybeSingle = async () => ({
          data: { id: "employee-1", facility_id: "facility-1", employee_role: roles[0], is_active: true },
          error: null,
        });
        return { select: () => query };
      }
      if (table === "facilities")
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "facility-1", is_active: true }, error: null,
        }) }) }) };
      throw new Error(`Unexpected database access: ${table}`);
    });
  });

  afterAll(async () => {
    await app?.close();
    if (originalSecret === undefined)
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
  });

  it.each(["/v1/health", "/v1/health/live", "/v1/health/ready"])(
    "serves %s publicly",
    async (url) => {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toMatch(/^(ok|ready)$/);
    },
  );

  it("returns 503 when Supabase is unavailable", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        limit: () => ({
          abortSignal: async () => ({ error: { message: "Unavailable" } }),
        }),
      }),
    }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/health/ready",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ready: false,
      checks: { supabase: false },
    });
  });

  it.each(['customer', 'driver', 'manager', 'facility_employee'])(
    'blocks %s from every Admin customer/order route', async role => {
      roles = [role];
      const id = '00000000-0000-4000-8000-000000000001';
      for (const url of [
        '/v1/admin/customers', `/v1/admin/customers/${id}`,
        `/v1/admin/customers/${id}/orders`, `/v1/admin/orders/${id}`,
      ]) {
        expect((await app.inject({method: 'GET', url, headers: {authorization: 'Bearer local-test'}})).statusCode).toBe(403);
      }
      expect((await app.inject({method: 'POST', url: `/v1/admin/orders/${id}/cancel`,
        headers: {authorization: 'Bearer local-test'}, payload: {reason: 'Customer request'}})).statusCode).toBe(403);
    },
  );

  it('allows the verified Admin role through the customer route without customer ownership bypass', async () => {
    roles = ['admin'];
    const service = app.get(AdminManagementService);
    const read = jest.spyOn(service, 'customers').mockResolvedValueOnce([{id: 'customer-1'}] as any);
    const response = await app.inject({method: 'GET', url: '/v1/admin/customers', headers: {authorization: 'Bearer local-test'}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{id: 'customer-1'}]);
    expect(read).toHaveBeenCalled();
    read.mockRestore();
  });

  it.each(['customer', 'driver', 'manager', 'facility_employee'])(
    'blocks %s from every Admin claim and refund route', async role => {
      roles = [role];
      const id = '00000000-0000-4000-8000-000000000001';
      const headers = {authorization: 'Bearer local-test'};
      for (const url of ['/v1/admin/issues', `/v1/admin/issues/orders/${id}`])
        expect((await app.inject({method: 'GET', url, headers})).statusCode).toBe(403);
      for (const url of [
        `/v1/admin/issues/orders/${id}/claims/${id}/decision`,
        `/v1/admin/issues/orders/${id}/payments/${id}/refunds`,
        `/v1/admin/issues/orders/${id}/refunds/${id}/approve`,
        `/v1/admin/issues/orders/${id}/refunds/${id}/reject`,
      ]) expect((await app.inject({method: 'POST', url, headers, payload: {notes: 'Forbidden', reason: 'Forbidden', status: 'approved', amount: 1}})).statusCode).toBe(403);
    },
  );

  it('allows Admin issue queue and rejects invalid refund amounts before service access', async () => {
    roles = ['admin'];
    const service = app.get(AdminIssuesService);
    const overview = jest.spyOn(service, 'overview').mockResolvedValueOnce({claims: [], refunds: [], cancellations: []} as any);
    const headers = {authorization: 'Bearer local-test'};
    expect((await app.inject({method: 'GET', url: '/v1/admin/issues', headers})).statusCode).toBe(200);
    expect(overview).toHaveBeenCalled(); overview.mockRestore();
    const id = '00000000-0000-4000-8000-000000000001';
    const invalid = await app.inject({method: 'POST', url: `/v1/admin/issues/orders/${id}/payments/${id}/refunds`, headers,
      payload: {amount: -1, reason: 'Invalid amount'}});
    expect(invalid.statusCode).toBe(400);
  });

  it.each(['customer', 'driver', 'manager', 'facility_employee'])(
    'blocks %s from Admin growth management', async role => {
      roles = [role];
      const id = '00000000-0000-4000-8000-000000000001';
      const headers = {authorization: 'Bearer local-test'};
      expect((await app.inject({method: 'GET', url: '/v1/admin/growth', headers})).statusCode).toBe(403);
      for (const url of ['/v1/admin/growth/offers', '/v1/admin/growth/packages'])
        expect((await app.inject({method: 'POST', url, headers, payload: {}})).statusCode).toBe(403);
      for (const url of [`/v1/admin/growth/offers/${id}/active`, `/v1/admin/growth/packages/${id}/active`,
        '/v1/admin/growth/settings'])
        expect((await app.inject({method: 'PATCH', url, headers, payload: {isActive: true}})).statusCode).toBe(403);
    },
  );

  it('allows Admin growth overview through the real role guard', async () => {
    roles = ['admin'];
    const service = app.get(AdminGrowthService);
    const overview = jest.spyOn(service, 'overview').mockResolvedValueOnce({offers: [], packages: []} as any);
    const response = await app.inject({method: 'GET', url: '/v1/admin/growth', headers: {authorization: 'Bearer local-test'}});
    expect(response.statusCode).toBe(200);
    expect(overview).toHaveBeenCalled(); overview.mockRestore();
  });

  it.each(['customer', 'driver', 'manager', 'facility_employee'])(
    'blocks %s from every cross-Facility oversight route', async role => {
      roles = [role];
      const id = '00000000-0000-4000-8000-000000000001';
      for (const url of ['/v1/admin/facilities', `/v1/admin/facilities/${id}`,
        `/v1/admin/facilities/${id}/orders/${id}`])
        expect((await app.inject({method: 'GET', url, headers: {authorization: 'Bearer local-test'}})).statusCode).toBe(403);
    },
  );

  it('allows verified Admin read-only Facility oversight', async () => {
    roles = ['admin'];
    const service = app.get(AdminFacilityOversightService);
    const list = jest.spyOn(service, 'list').mockResolvedValueOnce({facilities: []} as any);
    const response = await app.inject({method: 'GET', url: '/v1/admin/facilities',
      headers: {authorization: 'Bearer local-test'}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({facilities: []});
    list.mockRestore();
  });

  it.each(['customer', 'driver', 'manager', 'facility_employee'])(
    'blocks %s from Admin reports, audit search and CSV export', async role => {
      roles = [role];
      for (const url of ['/v1/admin/analytics/report', '/v1/admin/analytics/audit',
        '/v1/admin/analytics/report.csv', '/v1/admin/analytics/audit.csv'])
        expect((await app.inject({method: 'GET', url, headers: {authorization: 'Bearer local-test'}})).statusCode).toBe(403);
    },
  );

  it('allows verified Admin report access and validates report dates', async () => {
    roles = ['admin'];
    const service = app.get(AnalyticsReportsService);
    const report = jest.spyOn(service, 'report').mockResolvedValueOnce({range: {from: '2026-09-01'}} as any);
    const response = await app.inject({method: 'GET', url: '/v1/admin/analytics/report',
      headers: {authorization: 'Bearer local-test'}});
    expect(response.statusCode).toBe(200);
    expect(report).toHaveBeenCalled(); report.mockRestore();
    const invalid = await app.inject({method: 'GET', url: '/v1/admin/analytics/report?from=not-a-date',
      headers: {authorization: 'Bearer local-test'}});
    expect(invalid.statusCode).toBe(400);
  });

  it.each(['customer', 'driver', 'manager', 'facility_employee'])(
    'blocks %s from Admin staff lifecycle routes', async role => {
      roles = [role];
      const id = '00000000-0000-4000-8000-000000000001';
      for (const url of ['/v1/admin/staff', '/v1/admin/staff/facilities', `/v1/admin/staff/${id}`]) {
        expect((await app.inject({method: 'GET', url, headers: {authorization: 'Bearer local-test'}})).statusCode).toBe(403);
      }
      for (const url of [`/v1/admin/staff/${id}/deactivate`, `/v1/admin/staff/${id}/activate`,
        `/v1/admin/staff/${id}/revoke-access`, `/v1/admin/staff/${id}/facility`]) {
        expect((await app.inject({method: 'PATCH', url, headers: {authorization: 'Bearer local-test'},
          payload: {facilityId: id}})).statusCode).toBe(403);
      }
      expect((await app.inject({method: 'POST', url: '/v1/admin/staff', headers: {authorization: 'Bearer local-test'},
        payload: {phone: '+16505550177', fullName: 'Forbidden', role: 'driver'}})).statusCode).toBe(403);
    },
  );

  it('allows only a verified Admin to search staff and validates facility assignment', async () => {
    roles = ['admin'];
    const service = app.get(StaffService);
    const list = jest.spyOn(service, 'list').mockResolvedValueOnce([{profile_id: 'fictional'}] as any);
    const response = await app.inject({method: 'GET', url: '/v1/admin/staff', headers: {authorization: 'Bearer local-test'}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{profile_id: 'fictional'}]);
    list.mockRestore();
    const id = '00000000-0000-4000-8000-000000000001';
    const invalid = await app.inject({method: 'PATCH', url: `/v1/admin/staff/${id}/facility`,
      headers: {authorization: 'Bearer local-test'}, payload: {facilityId: 'invalid'}});
    expect(invalid.statusCode).toBe(400);
  });

  it("serves Swagger and rejects anonymous requests to every protected route", async () => {
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBe(
      200,
    );
    const response = await app.inject({ method: "GET", url: "/docs-json" });
    expect(response.statusCode).toBe(200);
    const paths = response.json().paths;
    expect(
      paths["/v1/driver-assignments/{assignmentId}/facility-transit"],
    ).toBeDefined();
    expect(paths["/v1/orders/{id}/claim-period"]).toBeDefined();
    expect(paths["/v1/orders/{id}/cancel"]).toBeDefined();
    expect(paths["/v1/payments/orders/{orderId}"].get).toBeDefined();
    expect(paths["/v1/services"].get.security).toEqual([{ bearer: [] }]);
    expect(paths["/v1/services"].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "facilityId",
          required: false,
          in: "query",
        }),
      ]),
    );
    expect(
      paths["/v1/services"].get.responses["200"].content["application/json"]
        .schema.type,
    ).toBe("array");
    expect(paths["/v1/orders/{id}/complete-claim-period"]).toBeDefined();
    const publicPaths = new Set([
      "/v1/health",
      "/v1/health/live",
      "/v1/health/ready",
      "/v1/auth/phone/request-otp",
      "/v1/auth/phone/verify-otp",
      "/v1/auth/refresh",
      "/v1/auth/signup",
      "/v1/auth/signin",
      "/v1/auth/forgot-password",
      "/v1/payments/webhook/razorpay",
    ]);
    let checked = 0;
    for (const [path, methods] of Object.entries(paths)) {
      if (publicPaths.has(path)) continue;
      for (const method of Object.keys(methods as object)) {
        const result = await app.inject({
          method: method.toUpperCase() as "GET",
          url: path.replace(
            /\{[^}]+\}/g,
            "00000000-0000-4000-8000-000000000001",
          ),
        });
        expect({ method, path, status: result.statusCode }).toEqual({
          method,
          path,
          status: 401,
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([undefined, "00000000-0000-4000-8000-000000000001"])(
    "serves customer pricing for scope %s through real guards and service",
    async (facilityId) => {
      const authFrom = from.getMockImplementation()!;

      const facilityQuery: any = {};
      for (const method of ["select", "eq"]) {
        facilityQuery[method] = jest.fn(() => facilityQuery);
      }
      facilityQuery.maybeSingle = jest.fn(async () => ({
        data: {
          id: facilityId ?? "00000000-0000-4000-8000-000000000001",
        },
        error: null,
      }));

      const servicesQuery: any = {};
      for (const method of ["select", "eq", "order"]) {
        servicesQuery[method] = jest.fn(() => servicesQuery);
      }
      servicesQuery.then = (resolve: any) =>
        Promise.resolve({
          data: [
            {
              id: "service-1",
              category_id: "category-1",
              name: "Wash",
              description: null,
              pricing_unit: "item",
            },
          ],
          error: null,
        }).then(resolve);

      const categoryQuery: any = {};
      for (const method of ["select", "in", "eq"]) {
        categoryQuery[method] = jest.fn(() => categoryQuery);
      }
      categoryQuery.then = (resolve: any) =>
        Promise.resolve({
          data: [
            {
              id: "category-1",
              name: "Wash & Iron",
            },
          ],
          error: null,
        }).then(resolve);

      const priceQuery: any = {};
      for (const method of ["select", "in", "eq", "is", "lte", "or", "order"]) {
        priceQuery[method] = jest.fn(() => priceQuery);
      }

      priceQuery.then = (resolve: any) =>
        Promise.resolve({
          data: [
            {
              service_id: "service-1",
              price: "42.50",
              effective_from: "2026-09-11T00:00:00.000Z",
            },
          ],
          error: null,
        }).then(resolve);

      from.mockImplementation((table: string) => {
        if (table === "facilities") {
          return facilityQuery;
        }

        if (table === "services") {
          return servicesQuery;
        }

        if (table === "service_categories") {
          return categoryQuery;
        }

        if (table === "service_prices") {
          return priceQuery;
        }

        return authFrom(table);
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/services${facilityId ? `?facilityId=${facilityId}` : ""}`,
        headers: {
          authorization: "Bearer customer",
        },
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toEqual([
        {
          id: "service-1",
          categoryId: "category-1",
          categoryName: "Wash & Iron",
          name: "Wash",
          description: null,
          pricingUnit: "item",
          price: 42.5,
          facilityId: facilityId ?? null,
        },
      ]);

      expect(servicesQuery.eq).toHaveBeenCalledWith("is_active", true);

      expect(categoryQuery.in).toHaveBeenCalledWith("id", ["category-1"]);

      expect(categoryQuery.eq).toHaveBeenCalledWith("is_active", true);

      expect(priceQuery.in).toHaveBeenCalledWith("service_id", ["service-1"]);

      if (facilityId) {
        expect(facilityQuery.eq).toHaveBeenCalledWith("id", facilityId);

        expect(facilityQuery.eq).toHaveBeenCalledWith("is_active", true);

        expect(priceQuery.eq).toHaveBeenCalledWith("facility_id", facilityId);

        expect(priceQuery.is).not.toHaveBeenCalled();
      } else {
        expect(priceQuery.is).toHaveBeenCalledWith("facility_id", null);
      }

      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    "facilityId=invalid",
    "facilityId=",
    "facilityId=00000000-0000-4000-8000-000000000001&facilityId=00000000-0000-4000-8000-000000000002",
    "unexpected=true",
  ])(
    "rejects invalid catalogue query %s before catalogue access",
    async (query) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/services?${query}`,
        headers: { authorization: "Bearer customer" },
      });
      expect(response.statusCode).toBe(400);
      expect(from.mock.calls.map(([table]) => table)).toEqual([
        "profiles",
        "profile_roles",
      ]);
    },
  );

  it("rejects an invalid session at the catalogue", async () => {
    getUser.mockResolvedValue(null);
    const response = await app.inject({
      method: "GET",
      url: "/v1/services",
      headers: { authorization: "Bearer invalid" },
    });
    expect(response.statusCode).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects inactive profiles at the catalogue", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { is_active: false },
            error: null,
          }),
        }),
      }),
    }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/services",
      headers: { authorization: "Bearer inactive" },
    });
    expect(response.statusCode).toBe(401);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it.each(["request-otp", "verify-otp"])(
    "validates %s input before requesting an OTP",
    async (action) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/auth/phone/${action}`,
        payload: { phone: "invalid", extra: true },
      });
      expect(response.statusCode).toBe(400);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each(["admin", "customer", "driver", "manager"])(
    "resolves the %s authentication context",
    async (role) => {
      roles = [role];
      const response = await app.inject({
        method: "GET",
        url: "/v1/rbac/context",
        headers: { authorization: "Bearer test-token" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: "profile-1", roles: [role] });
    },
  );

  it("rejects an invalid session", async () => {
    getUser.mockResolvedValue(null);
    const response = await app.inject({
      method: "GET",
      url: "/v1/orders",
      headers: { authorization: "Bearer invalid" },
    });
    expect(response.statusCode).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a customer at the role-protected endpoint", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/rbac/protected-example",
      headers: { authorization: "Bearer customer" },
    });
    expect(response.statusCode).toBe(403);
  });

  it.each(["driver", "facility_employee", "manager"])(
    "denies %s access to Admin analytics", async role => {
      roles = [role];
      const response = await app.inject({
        method: "GET", url: "/v1/admin/analytics/dashboard",
        headers: { authorization: "Bearer operational-user" },
      });
      expect(response.statusCode).toBe(403);
    },
  );

  it.each([
    ["GET", "/v1/admin/analytics/dashboard"],
    [
      "POST",
      "/v1/payments/refunds/00000000-0000-4000-8000-000000000001/approve",
    ],
    ["POST", "/v1/orders/00000000-0000-4000-8000-000000000001/claim-period"],
    [
      "POST",
      "/v1/orders/00000000-0000-4000-8000-000000000001/complete-claim-period",
    ],
  ])("denies customers access to %s %s", async (method, url) => {
    const response = await app.inject({
      method: method as "GET" | "POST",
      url,
      headers: { authorization: "Bearer customer" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("retains admin access to analytics", async () => {
    roles = ["admin"];
    const dashboard = jest
      .spyOn(app.get(AnalyticsService), "dashboard")
      .mockResolvedValue([]);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/admin/analytics/dashboard",
        headers: { authorization: "Bearer admin" },
      });
      expect(response.statusCode).toBe(200);
      expect(dashboard).toHaveBeenCalledTimes(1);
    } finally {
      dashboard.mockRestore();
    }
  });

  it("rejects an Admin token with a conflicting Customer role", async () => {
    roles = ["admin", "customer"];
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/analytics/dashboard",
      headers: { authorization: "Bearer admin" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("retains admin access to refund approval without issuing a real refund", async () => {
    roles = ["admin"];
    const refundId = "00000000-0000-4000-8000-000000000001";
    const approve = jest
      .spyOn(app.get(PaymentsService), "approveRefund")
      .mockResolvedValue({
        refundId,
        providerRefundId: "refund-test",
        status: "approved",
        duplicate: false,
        provider: "mock",
      });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/v1/payments/refunds/${refundId}/approve`,
        headers: { authorization: "Bearer admin" },
      });
      expect(response.statusCode).toBe(201);
      expect(approve).toHaveBeenCalledWith("profile-1", refundId, "Approved by Admin");
    } finally {
      approve.mockRestore();
    }
  });

  it("lets a customer cancel an owned order through the validated endpoint", async () => {
    const orderId = "00000000-0000-4000-8000-000000000001";
    const cancel = jest.spyOn(app.get(OrdersService), "cancel").mockResolvedValue({
      orderId,
      orderStatus: "cancelled",
      duplicate: false,
      paymentOrderId: null,
      refundRequestId: null,
      refundStatus: null,
      refundAmount: 0,
      refundCreated: false,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/cancel`,
        headers: { authorization: "Bearer customer" },
        payload: { reason: "  Pickup is no longer needed  " },
      });
      expect(response.statusCode).toBe(201);
      expect(cancel).toHaveBeenCalledWith(
        "profile-1",
        orderId,
        "Pickup is no longer needed",
      );
      expect(response.json()).toMatchObject({
        orderId,
        orderStatus: "cancelled",
      });
    } finally {
      cancel.mockRestore();
    }
  });

  it("rejects an empty cancellation reason before service access", async () => {
    const cancel = jest.spyOn(app.get(OrdersService), "cancel");
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders/00000000-0000-4000-8000-000000000001/cancel",
        headers: { authorization: "Bearer customer" },
        payload: { reason: "   " },
      });
      expect(response.statusCode).toBe(400);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      cancel.mockRestore();
    }
  });

  it("returns an owned payment and refund recovery summary", async () => {
    const orderId = "00000000-0000-4000-8000-000000000001";
    const summary = jest
      .spyOn(app.get(PaymentsService), "getOrderPaymentSummary")
      .mockResolvedValue({
        orderId,
        payment: null,
        refunds: [],
        refundEligibility: {eligible: false, remainingAmount: 0},
      });
    try {
      const response = await app.inject({
        method: "GET",
        url: `/v1/payments/orders/${orderId}`,
        headers: { authorization: "Bearer customer" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        orderId,
        payment: null,
        refunds: [],
        refundEligibility: {eligible: false, remainingAmount: 0},
      });
      expect(summary).toHaveBeenCalledWith("profile-1", orderId);
    } finally {
      summary.mockRestore();
    }
  });

  it("validates customer refund reasons before atomic request processing", async () => {
    const requestRefund = jest.spyOn(
      app.get(PaymentsService),
      "requestRefund",
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/payments/refunds/00000000-0000-4000-8000-000000000001/request",
        headers: { authorization: "Bearer customer" },
        payload: { amount: 10, reason: "  " },
      });
      expect(response.statusCode).toBe(400);
      expect(requestRefund).not.toHaveBeenCalled();
    } finally {
      requestRefund.mockRestore();
    }
  });

  it("preserves exact webhook bytes for signature verification", async () => {
    from.mockImplementation(() => {
      const query: any = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({
        data: {
          id: "existing-event",
          processing_status: "processed",
        },
        error: null,
      });
      return query;
    });
    const payload = '{ "event": "payment.captured", "payload": {} }';
    const signature = createHmac("sha256", "e2e-webhook-secret")
      .update(payload)
      .digest("hex");
    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
      },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ processed: true, duplicate: true });
  });

  it("rejects malformed webhook signatures without database access", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/razorpay",
      headers: { "x-razorpay-signature": "é".repeat(64) },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
