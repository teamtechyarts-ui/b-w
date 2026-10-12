import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { SupabaseService } from "../supabase/supabase.service";
import { MapsService } from "../maps/maps.service";
import { RouteResult } from "../maps/maps.types";

type AssignmentType = "pickup" | "delivery";

const TRACKING_ASSIGNMENT_STATUSES = new Set([
  "pickup_assigned",
  "pickup_accepted",
  "en_route_pickup",
  "pickup_otp_pending",
  "delivery_assigned",
  "delivery_accepted",
  "en_route_delivery",
  "delivery_otp_pending",
]);

const LIVE_LOCATION_STATUSES = new Set([
  "en_route_pickup",
  "pickup_otp_pending",
  "en_route_delivery",
  "delivery_otp_pending",
]);

@Injectable()
export class LogisticsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly maps: MapsService,
  ) {}

  private db() {
    return this.supabase.admin;
  }

  private async requireAdminOrManager(profileId: string) {
    const { data, error } = await this.db()
      .from("profile_roles")
      .select("roles(code)")
      .eq("profile_id", profileId);

    if (error) {
      throw new ForbiddenException("Unable to verify assignment permission");
    }

    const allowed = (data ?? []).some((row: any) =>
      ["admin", "manager"].includes(row.roles?.code),
    );

    if (!allowed) {
      throw new ForbiddenException("Admin or manager role required");
    }
  }

  private async driverId(profileId: string): Promise<string> {
    const { data, error } = await this.db()
      .from("drivers")
      .select("id,is_active")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error || !data || !data.is_active) {
      throw new NotFoundException("Active driver profile not found");
    }

    return data.id;
  }

  async updateAvailability(profileId: string, isAvailable: boolean) {
    const driverId = await this.driverId(profileId);

    const { error } = await this.db()
      .from("drivers")
      .update({
        is_available: isAvailable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      driverId,
      isAvailable,
    };
  }

  async updateLocation(
    profileId: string,
    assignmentId: string,
    latitude: number,
    longitude: number,
    accuracyM?: number,
  ) {
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      (accuracyM !== undefined &&
        (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 100_000))
    ) {
      throw new BadRequestException("Invalid driver location");
    }

    const driverId = await this.driverId(profileId);

    if (!assignmentId) throw new BadRequestException("Assignment is required");
    const { data, error } = await this.db().rpc("publish_driver_trip_location_atomic", {
      p_assignment_id: assignmentId,
      p_driver_id: driverId,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracyM ?? null,
    });

    if (error?.code === "P0002") throw new NotFoundException("Assignment not found");
    if (error) {
      throw new ConflictException(error.message);
    }

    return {
      driverId,
      assignmentId,
      published: data?.published === true,
      recordedAt: data?.recordedAt ?? null,
    };
  }

  async trackOrder(profileId: string, orderId: string) {
    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,current_status,customers(profile_id)")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new NotFoundException("Order not found");
    }

    const { data: roleRows, error: roleError } = await this.db()
      .from("profile_roles")
      .select("roles(code)")
      .eq("profile_id", profileId);

    if (roleError) {
      throw new ForbiddenException("Unable to verify tracking access");
    }

    const roleCodes = (roleRows ?? [])
      .map((row: any) => row.roles?.code)
      .filter((code: unknown): code is string => typeof code === "string");
    const isOwner = (order as any).customers?.profile_id === profileId;
    const isPrivileged = roleCodes.some((code: string) =>
      ["admin", "manager"].includes(code),
    );

    let requesterDriverId: string | null = null;
    if (!isOwner && !isPrivileged && roleCodes.includes("driver")) {
      const { data: driver, error: driverError } = await this.db()
        .from("drivers")
        .select("id,is_active")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (driverError || !driver?.is_active) {
        throw new ForbiddenException("Not authorized to track this order");
      }

      requesterDriverId = driver.id;
    }

    if (!isOwner && !isPrivileged && !requesterDriverId) {
      throw new ForbiddenException("Not authorized to track this order");
    }

    if (!TRACKING_ASSIGNMENT_STATUSES.has(order.current_status)) {
      return {
        orderId: order.id,
        orderStatus: order.current_status,
        assignment: null,
        location: null,
        distanceMeters: null,
        etaMinutes: null,
      };
    }

    let assignmentQuery = this.db()
      .from("driver_assignments")
      .select(
        "id,driver_id,assignment_type,status,assigned_at,accepted_at,completed_at",
      )
      .eq("order_id", orderId)
      .in("status", ["assigned", "accepted", "en_route", "arrived"])
      .order("assigned_at", { ascending: false })
      .limit(1);

    if (requesterDriverId) {
      assignmentQuery = assignmentQuery.eq("driver_id", requesterDriverId);
    }

    const { data: assignment, error: assignmentError } =
      await assignmentQuery.maybeSingle();

    if (assignmentError) {
      throw new BadRequestException("Unable to load order tracking");
    }

    if (requesterDriverId && !assignment) {
      throw new ForbiddenException("Not authorized to track this order");
    }

    if (!assignment) {
      return {
        orderId: order.id,
        orderStatus: order.current_status,
        assignment: null,
        location: null,
        distanceMeters: null,
        etaMinutes: null,
      };
    }

    if (!LIVE_LOCATION_STATUSES.has(order.current_status)) {
      return {
        orderId: order.id,
        orderStatus: order.current_status,
        assignment: {
          id: assignment.id,
          type: assignment.assignment_type,
          status: assignment.status,
          assignedAt: assignment.assigned_at,
          acceptedAt: assignment.accepted_at,
        },
        location: null,
        distanceMeters: null,
        etaMinutes: null,
      };
    }

    const { data: location, error: locationError } = await this.db()
      .from("driver_trip_locations")
      .select("latitude,longitude,accuracy_m,recorded_at")
      .eq("assignment_id", assignment.id)
      .maybeSingle();

    if (locationError) {
      throw new BadRequestException("Unable to load driver location");
    }

    const recordedAt = location?.recorded_at ?? null;
    const recordedAtMs = recordedAt ? new Date(recordedAt).getTime() : NaN;

    return {
      orderId: order.id,
      orderStatus: order.current_status,
      assignment: {
        id: assignment.id,
        type: assignment.assignment_type,
        status: assignment.status,
        assignedAt: assignment.assigned_at,
        acceptedAt: assignment.accepted_at,
      },
      location: location
        ? {
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
            accuracyM:
              location.accuracy_m == null
                ? null
                : Number(location.accuracy_m),
            recordedAt,
            stale:
              !Number.isFinite(recordedAtMs) ||
              Date.now() - recordedAtMs > 2 * 60 * 1000,
          }
        : null,
      // Tracking intentionally does not request routes. In Development/UAT the
      // location comes from the local driver-location endpoint and uses no
      // Google Maps traffic. Route estimates can be populated later when a
      // configured provider explicitly supplies them.
      distanceMeters: null,
      etaMinutes: null,
    };
  }

  async assignBestDriver(
    orderId: string,
    assignmentType: AssignmentType,
    actorProfileId?: string,
  ) {
    if (actorProfileId) {
      await this.requireAdminOrManager(actorProfileId);
    }

    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,current_status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new NotFoundException("Order not found");
    }

    const allowedOrderStatuses =
      assignmentType === "pickup"
        ? ["confirmed", "pickup_failed"]
        : ["ready_for_delivery", "delivery_failed"];

    if (!allowedOrderStatuses.includes(order.current_status)) {
      throw new ConflictException(
        `${assignmentType} assignment is not allowed while order is ${order.current_status}`,
      );
    }

    const { data: existing, error: existingError } = await this.db()
      .from("driver_assignments")
      .select("id,status")
      .eq("order_id", orderId)
      .eq("assignment_type", assignmentType)
      .in("status", ["assigned", "accepted", "en_route", "arrived"])
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(existingError.message);
    }

    if (existing) {
      throw new ConflictException("An active assignment already exists");
    }

    const { data: candidates, error: candidateError } = await this.db().rpc(
      "find_driver_assignment_candidates",
      {
        p_order_id: orderId,
        p_assignment_type: assignmentType,
        p_limit: 12,
      },
    );

    if (candidateError) {
      throw new BadRequestException(
        `Candidate search failed: ${candidateError.message}`,
      );
    }

    if (!candidates?.length) {
      throw new NotFoundException("No available drivers found");
    }

    const scored: any[] = [];

    for (const candidate of candidates) {
      let distanceKm = 0;
      let etaMinutes = 0;

      try {
        const route = await this.maps.getRoute(
          {
            latitude: Number(candidate.driver_latitude),
            longitude: Number(candidate.driver_longitude),
          },
          {
            latitude: Number(candidate.target_latitude),
            longitude: Number(candidate.target_longitude),
          },
        );

        distanceKm = route.distanceMeters / 1000;
        etaMinutes = route.durationSeconds / 60;
      } catch {
        const dLat =
          ((Number(candidate.target_latitude) -
            Number(candidate.driver_latitude)) *
            Math.PI) /
          180;
        const dLon =
          ((Number(candidate.target_longitude) -
            Number(candidate.driver_longitude)) *
            Math.PI) /
          180;
        const lat1 = (Number(candidate.driver_latitude) * Math.PI) / 180;
        const lat2 = (Number(candidate.target_latitude) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.sin(dLon / 2) *
            Math.sin(dLon / 2) *
            Math.cos(lat1) *
            Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceKm = 6371 * c;
        etaMinutes = distanceKm > 0 ? (distanceKm / 30) * 60 : 5;
      }

      const workload = Number(candidate.active_workload ?? 0);

      const routeCompatibility = Number(candidate.route_compatibility ?? 0);

      const score =
        distanceKm * 0.35 +
        etaMinutes * 0.3 +
        workload * 0.25 +
        routeCompatibility * 0.1;

      scored.push({
        ...candidate,
        distanceKm,
        etaMinutes,
        workload,
        routeCompatibility,
        score,
      });
    }

    scored.sort((a, b) => a.score - b.score);

    const best = scored[0];

    const { data: committed, error: insertError } = await this.db().rpc(
      "create_driver_assignment_atomic",
      {
        p_order_id: orderId,
        p_driver_id: best.driver_id,
        p_assignment_type: assignmentType,
        p_assignment_score: best.score,
      },
    );

    if (insertError || !committed?.assignment) {
      throw new ConflictException(
        insertError?.message ?? "Unable to create driver assignment",
      );
    }

    return {
      assignment: committed.assignment,
      scoring: best,
    };
  }

  async respondToAssignment(
    profileId: string,
    assignmentId: string,
    accept: boolean,
    rejectionReason?: string,
  ) {
    const reason = rejectionReason?.trim();
    if (!accept && !reason) {
      throw new BadRequestException("A rejection reason is required");
    }
    const driverId = await this.driverId(profileId);

    const { data, error } = await this.db().rpc(
      "transition_driver_assignment_atomic",
      {
        p_assignment_id: assignmentId,
        p_driver_id: driverId,
        p_action: accept ? "accept" : "reject",
        p_rejection_reason: accept ? null : reason,
      },
    );

    if (error?.code === "P0002") {
      throw new NotFoundException("Assignment not found");
    }

    if (error || !data?.assignment) {
      throw new ConflictException(
        error?.message ?? "Unable to respond to assignment",
      );
    }

    try {
      if (typeof this.supabase?.broadcastEvent === "function" && data?.orderId) {
        const { data: ord } = await this.db()
          .from("orders")
          .select("customer_id,facility_id")
          .eq("id", data.orderId)
          .maybeSingle();

        const payload = {
          eventType: "ORDER_STATUS_CHANGED",
          entityId: data.orderId,
          orderId: data.orderId,
          status: data.orderStatus,
          driverId,
          timestamp: new Date().toISOString(),
        };

        const broadcasts: Promise<any>[] = [
          this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`order:${data.orderId}`, "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", payload),
        ];
        if (ord?.customer_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`customer:${ord.customer_id}`, "ORDER_STATUS_CHANGED", payload),
          );
        }
        await Promise.allSettled(broadcasts);
      }
    } catch {
      // Safe catch
    }

    return data.assignment;
  }

  async reassignDriver(
    profileId: string,
    assignmentId: string,
    newDriverId: string,
  ) {
    if (!newDriverId) {
      throw new BadRequestException("A replacement driver is required");
    }
    const { data, error } = await this.db().rpc(
      "reassign_driver_assignment_atomic",
      {
        p_assignment_id: assignmentId,
        p_admin_profile_id: profileId,
        p_new_driver_id: newDriverId,
      },
    );
    if (error?.code === "42501") {
      throw new ForbiddenException("Admin role required");
    }
    if (error?.code === "P0002") {
      throw new NotFoundException("Assignment not found");
    }
    if (error || !data?.assignment) {
      throw new ConflictException(error?.message ?? "Unable to reassign driver");
    }
    return data;
  }

  async startNavigation(profileId: string, assignmentId: string) {
    const driverId = await this.driverId(profileId);

    const { data: assignment, error: assignmentError } = await this.db()
      .from("driver_assignments")
      .select("id,order_id,assignment_type,status")
      .eq("id", assignmentId)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (assignment.assignment_type === "delivery") {
      const { data: collectionOp } = await this.db()
        .from("driver_navigation_events")
        .select("id")
        .eq("order_id", assignment.order_id)
        .eq("event_type", "driver_collection_confirmed")
        .maybeSingle();

      if (!collectionOp) {
        await this.db()
          .from("driver_navigation_events")
          .insert({
            driver_id: driverId,
            order_id: assignment.order_id,
            event_type: "navigate_facility",
          });

        return {
          assignmentId,
          orderId: assignment.order_id,
          provider: this.maps.providerName,
          status: "en_route_facility",
          destination: "facility",
        };
      }
    }

    const { data, error } = await this.db().rpc(
      "transition_driver_assignment_atomic",
      {
        p_assignment_id: assignmentId,
        p_driver_id: driverId,
        p_action: "start_navigation",
        p_rejection_reason: null,
      },
    );

    if (error?.code === "P0002") {
      throw new NotFoundException("Assignment not found");
    }

    if (error || !data) {
      throw new ConflictException(
        error?.message ?? "Unable to start navigation",
      );
    }

    try {
      if (typeof this.supabase?.broadcastEvent === "function" && data?.orderId) {
        const { data: ord } = await this.db()
          .from("orders")
          .select("customer_id,facility_id")
          .eq("id", data.orderId)
          .maybeSingle();

        const payload = {
          eventType: "ORDER_STATUS_CHANGED",
          entityId: data.orderId,
          orderId: data.orderId,
          status: data.orderStatus,
          driverId,
          timestamp: new Date().toISOString(),
        };

        const broadcasts: Promise<any>[] = [
          this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`order:${data.orderId}`, "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", payload),
        ];
        if (ord?.customer_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`customer:${ord.customer_id}`, "ORDER_STATUS_CHANGED", payload),
          );
        }
        await Promise.allSettled(broadcasts);
      }
    } catch {
      // Safe catch
    }

    return {
      assignmentId,
      orderId: data.orderId,
      provider: this.maps.providerName,
      status: "en_route",
    };
  }

  async arrive(profileId: string, assignmentId: string) {
    const driverId = await this.driverId(profileId);

    const { data: assignment, error: assignmentError } = await this.db()
      .from("driver_assignments")
      .select("id,order_id,assignment_type,status")
      .eq("id", assignmentId)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (assignment.assignment_type === "delivery") {
      const { data: collectionOp } = await this.db()
        .from("driver_navigation_events")
        .select("id")
        .eq("order_id", assignment.order_id)
        .eq("event_type", "driver_collection_confirmed")
        .maybeSingle();

      if (!collectionOp) {
        await this.db()
          .from("driver_navigation_events")
          .insert({
            driver_id: driverId,
            order_id: assignment.order_id,
            event_type: "arrived_at_facility",
          });

        return {
          assignmentId,
          orderId: assignment.order_id,
          assignmentStatus: "arrived",
          orderStatus: "delivery_accepted",
          facilityArrival: true,
        };
      }
    }

    const { data, error } = await this.db().rpc(
      "transition_driver_assignment_atomic",
      {
        p_assignment_id: assignmentId,
        p_driver_id: driverId,
        p_action: "arrive",
        p_rejection_reason: null,
      },
    );

    if (error?.code === "P0002") {
      throw new NotFoundException("Assignment not found");
    }

    if (error || !data) {
      throw new ConflictException(
        error?.message ?? "Unable to mark assignment arrived",
      );
    }

    try {
      if (typeof this.supabase?.broadcastEvent === "function" && data?.orderId) {
        const { data: ord } = await this.db()
          .from("orders")
          .select("customer_id,facility_id")
          .eq("id", data.orderId)
          .maybeSingle();

        const payload = {
          eventType: "ORDER_STATUS_CHANGED",
          entityId: data.orderId,
          orderId: data.orderId,
          status: data.orderStatus,
          driverId,
          timestamp: new Date().toISOString(),
        };

        const broadcasts: Promise<any>[] = [
          this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`order:${data.orderId}`, "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", payload),
        ];
        if (ord?.customer_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`customer:${ord.customer_id}`, "ORDER_STATUS_CHANGED", payload),
          );
        }
        await Promise.allSettled(broadcasts);
      }
    } catch {
      // Safe catch
    }

    return {
      assignmentId,
      orderId: data.orderId,
      assignmentStatus: data.assignmentStatus,
      orderStatus: data.orderStatus,
    };
  }

  async confirmFacilityHandover(profileId: string, assignmentId: string) {
    const driverId = await this.driverId(profileId);

    const { data: assignment, error: assignmentError } = await this.db()
      .from("driver_assignments")
      .select("id,order_id,assignment_type,status,driver_id")
      .eq("id", assignmentId)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (assignment.assignment_type !== "delivery") {
      throw new ConflictException(
        "Only delivery assignments can confirm facility collection",
      );
    }

    if (!["accepted", "arrived", "en_route"].includes(assignment.status)) {
      throw new ConflictException(
        "Assignment is not in a valid state for facility collection",
      );
    }

    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,facility_id,current_status")
      .eq("id", assignment.order_id)
      .maybeSingle();

    if (orderError || !order) {
      throw new NotFoundException("Order not found");
    }

    const { data: dispatchOp, error: dispatchError } = await this.db()
      .from("driver_navigation_events")
      .select("id,created_at")
      .eq("order_id", assignment.order_id)
      .eq("event_type", "facility_dispatch")
      .maybeSingle();

    if (dispatchError || !dispatchOp) {
      throw new ConflictException(
        "Facility employee must hand over the order before driver confirmation",
      );
    }

    const { data: existingCollection } = await this.db()
      .from("driver_navigation_events")
      .select("id,created_at")
      .eq("order_id", assignment.order_id)
      .eq("event_type", "driver_collection_confirmed")
      .maybeSingle();

    if (existingCollection) {
      return {
        assignmentId,
        orderId: assignment.order_id,
        facilityCollected: true,
        collected: true,
        confirmedAt: existingCollection.created_at,
        message: "Facility collection already confirmed",
      };
    }

    const now = new Date().toISOString();
    const { error: insertError } = await this.db()
      .from("driver_navigation_events")
      .insert({
        driver_id: driverId,
        order_id: assignment.order_id,
        event_type: "driver_collection_confirmed",
      });

    if (insertError) {
      throw new BadRequestException(insertError.message);
    }

    return {
      assignmentId,
      orderId: assignment.order_id,
      facilityCollected: true,
      collected: true,
      confirmedAt: now,
    };
  }

  async startFacilityTransit(profileId: string, assignmentId: string) {
    const driverId = await this.driverId(profileId);

    const { data: assignment, error: assignmentError } = await this.db()
      .from("driver_assignments")
      .select("id,order_id,assignment_type,status")
      .eq("id", assignmentId)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (assignment.assignment_type !== "pickup") {
      throw new ConflictException(
        "Only a pickup assignment can begin facility transit",
      );
    }

    if (assignment.status !== "arrived") {
      throw new ConflictException(
        "Pickup OTP must be completed before facility transit",
      );
    }

    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,current_status,facility_id,customer_id")
      .eq("id", assignment.order_id)
      .maybeSingle();

    if (orderError || !order) {
      throw new NotFoundException("Order not found");
    }

    if (order.current_status !== "picked_up") {
      throw new ConflictException(
        `Facility transit is not allowed while order is ${order.current_status}`,
      );
    }

    if (!order.facility_id) {
      throw new ConflictException("Order has no assigned facility");
    }

    const [facilityResult, locationResult] = await Promise.all([
      this.db()
        .from("facilities")
        .select("latitude,longitude,is_active")
        .eq("id", order.facility_id)
        .maybeSingle(),
      this.db()
        .from("driver_live_locations")
        .select("latitude,longitude")
        .eq("driver_id", driverId)
        .maybeSingle(),
    ]);

    const facility = facilityResult.data;
    const location = locationResult.data;

    if (
      facilityResult.error ||
      !facility?.is_active ||
      facility.latitude == null ||
      facility.longitude == null
    ) {
      throw new ConflictException(
        "Assigned facility has no active route destination",
      );
    }

    if (locationResult.error || !location) {
      throw new ConflictException(
        "Driver location is required for facility transit",
      );
    }

    const origin = {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    };
    const destination = {
      latitude: Number(facility.latitude),
      longitude: Number(facility.longitude),
    };
    let route: RouteResult | null = null;
    try {
      route = await this.maps.getRoute(origin, destination);
    } catch {
      // Maps route calculation is optional and must not block facility transit
      route = null;
    }

    const { data: committed, error: statusError } = await this.db().rpc(
      "start_facility_transit_atomic",
      {
        p_assignment_id: assignmentId,
        p_driver_id: driverId,
      },
    );

    if (statusError || !committed) {
      throw new BadRequestException(
        statusError?.message ?? "Unable to start facility transit",
      );
    }

    try {
      if (typeof this.supabase?.broadcastEvent === "function") {
        const payload = {
          eventType: "ORDER_STATUS_CHANGED",
          entityId: committed.orderId,
          orderId: committed.orderId,
          status: committed.orderStatus,
          facilityId: order.facility_id,
          timestamp: new Date().toISOString(),
        };

        const broadcasts: Promise<any>[] = [
          this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`order:${committed.orderId}`, "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent("facility:all", "ORDER_STATUS_CHANGED", payload),
          this.supabase.broadcastEvent(`facility:${order.facility_id}`, "ORDER_STATUS_CHANGED", payload),
        ];

        if (order.customer_id) {
          broadcasts.push(
            this.supabase.broadcastEvent(`customer:${order.customer_id}`, "ORDER_STATUS_CHANGED", payload),
          );
        }

        await Promise.allSettled(broadcasts);
      }
    } catch {
      // Safe catch
    }

    return {
      assignmentId,
      orderId: committed.orderId,
      assignmentStatus: committed.assignmentStatus,
      orderStatus: committed.orderStatus,
      provider: route?.provider ?? this.maps.providerName,
      route,
    };
  }

  async nearbyJobs(profileId: string, radiusKm = 3) {
    const driverId = await this.driverId(profileId);

    const safeRadius = Number.isFinite(radiusKm)
      ? Math.max(0.1, Math.min(radiusKm, 20))
      : 3;

    const { data, error } = await this.db().rpc("find_nearby_driver_jobs", {
      p_driver_id: driverId,
      p_radius_meters: safeRadius * 1000,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }
}
