import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { LogisticsService } from "./logistics.service";

function queryResult(data: any, error: any = null) {
  const query: any = {};
  for (const method of ["select", "eq"]) {
    query[method] = jest.fn(() => query);
  }
  query.maybeSingle = jest.fn().mockResolvedValue({ data, error });
  return query;
}

describe("LogisticsService facility transit", () => {
  function fixture(assignmentOverrides: Record<string, unknown> = {}) {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const tables: Record<string, any> = {
      drivers: queryResult({
        id: "driver-1",
        is_active: true,
      }),
      driver_assignments: queryResult({
        id: "assignment-1",
        order_id: "order-1",
        assignment_type: "pickup",
        status: "arrived",
        ...assignmentOverrides,
      }),
      orders: queryResult({
        id: "order-1",
        current_status: "picked_up",
        facility_id: "facility-1",
      }),
      facilities: queryResult({
        latitude: 17.385,
        longitude: 78.4867,
        is_active: true,
      }),
      driver_live_locations: queryResult({
        latitude: 17.4401,
        longitude: 78.3489,
      }),
      driver_navigation_events: { insert },
    };
    const rpc = jest.fn().mockImplementation((name: string) =>
      Promise.resolve(
        name === "start_facility_transit_atomic"
          ? {
              data: {
                assignmentId: "assignment-1",
                orderId: "order-1",
                assignmentStatus: "arrived",
                orderStatus: "in_transit_to_facility",
              },
              error: null,
            }
          : name === "transition_driver_assignment_atomic"
            ? {
                data: {
                  orderId: "order-1",
                },
                error: null,
              }
          : { data: null, error: null },
      ),
    );
    const maps = {
      providerName: "mock",
      getRoute: jest.fn().mockResolvedValue({
        distanceMeters: 12_345,
        durationSeconds: 987,
        encodedPolyline: null,
        provider: "mock",
      }),
    };
    const service = new LogisticsService(
      {
        admin: {
          from: jest.fn((table: string) => tables[table]),
          rpc,
        },
      } as any,
      maps as any,
    );
    return {
      service,
      maps,
      rpc,
      insert,
    };
  }

  it("routes an arrived pickup from picked-up order to its facility", async () => {
    const f = fixture();

    await expect(
      f.service.startFacilityTransit("driver-profile-1", "assignment-1"),
    ).resolves.toMatchObject({
      assignmentId: "assignment-1",
      orderId: "order-1",
      assignmentStatus: "arrived",
      orderStatus: "in_transit_to_facility",
      provider: "mock",
    });
    expect(f.maps.getRoute).toHaveBeenCalledWith(
      {
        latitude: 17.4401,
        longitude: 78.3489,
      },
      {
        latitude: 17.385,
        longitude: 78.4867,
      },
    );
    expect(f.rpc).toHaveBeenCalledWith(
      "start_facility_transit_atomic",
      {
        p_assignment_id: "assignment-1",
        p_driver_id: "driver-1",
      },
    );
    expect(f.insert).not.toHaveBeenCalled();
  });

  it("succeeds with facility transit even when Maps API is not configured or throws ServiceUnavailableException", async () => {
    const f = fixture();
    f.maps.getRoute.mockRejectedValue(
      new Error("Google Maps API is not configured for this environment."),
    );

    await expect(
      f.service.startFacilityTransit("driver-profile-1", "assignment-1"),
    ).resolves.toMatchObject({
      assignmentId: "assignment-1",
      orderId: "order-1",
      assignmentStatus: "arrived",
      orderStatus: "in_transit_to_facility",
      route: null,
    });
    expect(f.rpc).toHaveBeenCalledWith(
      "start_facility_transit_atomic",
      {
        p_assignment_id: "assignment-1",
        p_driver_id: "driver-1",
      },
    );
  });

  it("reports the selected Maps provider when navigation starts", async () => {
    const f = fixture();

    await expect(
      f.service.startNavigation("driver-profile-1", "assignment-1"),
    ).resolves.toMatchObject({
      assignmentId: "assignment-1",
      orderId: "order-1",
      provider: "mock",
      status: "en_route",
    });
  });

  it("rejects a delivery assignment before calling Maps or changing status", async () => {
    const f = fixture({
      assignment_type: "delivery",
    });

    await expect(
      f.service.startFacilityTransit("driver-profile-1", "assignment-1"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.maps.getRoute).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("LogisticsService order tracking", () => {
  function fluentResult(data: any, error: any = null) {
    const result = { data, error };
    const query: any = {};
    for (const method of ["select", "eq", "in", "order", "limit"]) {
      query[method] = jest.fn(() => query);
    }
    query.maybeSingle = jest.fn().mockResolvedValue(result);
    query.then = (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return query;
  }

  it("returns only the active assignment and location for the owning customer", async () => {
    const now = new Date().toISOString();
    const tables: Record<string, any> = {
      orders: fluentResult({
        id: "order-1",
        current_status: "en_route_pickup",
        customers: { profile_id: "customer-profile-1" },
      }),
      profile_roles: fluentResult([
        { roles: { code: "customer" } },
      ]),
      driver_assignments: fluentResult({
        id: "assignment-1",
        driver_id: "driver-1",
        assignment_type: "pickup",
        status: "en_route",
        assigned_at: now,
        accepted_at: now,
      }),
      driver_trip_locations: fluentResult({
        latitude: "17.3850000",
        longitude: "78.4867000",
        accuracy_m: "6.5",
        recorded_at: now,
        updated_at: now,
      }),
    };
    const service = new LogisticsService(
      {
        admin: {
          from: jest.fn((table: string) => tables[table]),
        },
      } as any,
      {} as any,
    );

    const tracking = await service.trackOrder(
      "customer-profile-1",
      "order-1",
    );

    expect(tracking).toMatchObject({
      orderId: "order-1",
      orderStatus: "en_route_pickup",
      assignment: {
        id: "assignment-1",
        type: "pickup",
        status: "en_route",
      },
      location: {
        latitude: 17.385,
        longitude: 78.4867,
        accuracyM: 6.5,
        stale: false,
      },
    });
    expect(tracking.assignment).not.toHaveProperty("driverId");
  });

  it("rejects a driver who is not actively assigned to the order", async () => {
    const tables: Record<string, any> = {
      orders: fluentResult({
        id: "order-1",
        current_status: "en_route_pickup",
        customers: { profile_id: "customer-profile-1" },
      }),
      profile_roles: fluentResult([{ roles: { code: "driver" } }]),
      drivers: fluentResult({ id: "driver-2", is_active: true }),
      driver_assignments: fluentResult(null),
      driver_trip_locations: fluentResult({
        latitude: 1,
        longitude: 2,
      }),
    };
    const from = jest.fn((table: string) => tables[table]);
    const service = new LogisticsService(
      { admin: { from } } as any,
      {} as any,
    );

    await expect(
      service.trackOrder("driver-profile-2", "order-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(from).not.toHaveBeenCalledWith("driver_trip_locations");
  });

  it("withholds tracking after completion or cancellation", async () => {
    const tables: Record<string, any> = {
      orders: fluentResult({
        id: "order-1",
        current_status: "completed",
        customers: { profile_id: "customer-profile-1" },
      }),
      profile_roles: fluentResult([{ roles: { code: "customer" } }]),
      driver_assignments: fluentResult({ id: "assignment-1" }),
      driver_trip_locations: fluentResult({ latitude: 1, longitude: 2 }),
    };
    const from = jest.fn((table: string) => tables[table]);
    const service = new LogisticsService({admin: {from}} as any, {} as any);

    await expect(
      service.trackOrder("customer-profile-1", "order-1"),
    ).resolves.toMatchObject({assignment: null, location: null});
    expect(from).not.toHaveBeenCalledWith("driver_assignments");
    expect(from).not.toHaveBeenCalledWith("driver_trip_locations");
  });

  it("marks an old driver update as stale", async () => {
    const oldTimestamp = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const tables: Record<string, any> = {
      orders: fluentResult({
        id: "order-1",
        current_status: "en_route_delivery",
        customers: { profile_id: "customer-profile-1" },
      }),
      profile_roles: fluentResult([{ roles: { code: "customer" } }]),
      driver_assignments: fluentResult({
        id: "assignment-1", driver_id: "driver-1", assignment_type: "delivery",
        status: "en_route", assigned_at: oldTimestamp, accepted_at: oldTimestamp,
      }),
      driver_trip_locations: fluentResult({
        latitude: 17.3, longitude: 78.4, accuracy_m: 8, recorded_at: oldTimestamp,
      }),
    };
    const service = new LogisticsService(
      {admin: {from: jest.fn((table: string) => tables[table])}} as any,
      {} as any,
    );

    await expect(
      service.trackOrder("customer-profile-1", "order-1"),
    ).resolves.toMatchObject({location: {stale: true}});
  });

  it("rejects invalid driver coordinates before accessing the database", async () => {
    const from = jest.fn();
    const service = new LogisticsService(
      { admin: { from } } as any,
      {} as any,
    );

    await expect(
      service.updateLocation("driver-profile-1", "assignment-1", 91, 78.4, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(from).not.toHaveBeenCalled();
  });

  it("publishes GPS only for the authenticated Driver's specified trip", async () => {
    const driver = fluentResult({id: 'driver-1', is_active: true});
    const rpc = jest.fn().mockResolvedValue({data: {published: true, recordedAt: '2026-09-18T00:00:00Z'}, error: null});
    const service = new LogisticsService({admin: {from: jest.fn(() => driver), rpc}} as any, {} as any);
    await expect(service.updateLocation('profile-1', 'assignment-1', 17.4, 78.4, 5)).resolves.toMatchObject({assignmentId: 'assignment-1', published: true});
    expect(rpc).toHaveBeenCalledWith('publish_driver_trip_location_atomic', {
      p_assignment_id: 'assignment-1', p_driver_id: 'driver-1',
      p_latitude: 17.4, p_longitude: 78.4, p_accuracy_m: 5,
    });
  });
});
