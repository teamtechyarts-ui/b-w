import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import { SupabaseService } from "../supabase/supabase.service";
import { LogisticsService } from "../logistics/logistics.service";
import { VerifyIntakeDto } from "./dto/verify-intake.dto";

type DeliveryDriverCandidate = {
  driver_id: string;
  active_workload: number | string | null;
};

@Injectable()
export class FacilityService {
  private readonly logger = new Logger(FacilityService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly logistics?: LogisticsService,
  ) {}

  private async triggerDeliveryAssignment(orderId: string) {
    // Under availability-based driver dispatch architecture, ready_for_delivery orders
    // automatically enter the available delivery job pool for drivers to claim.
  }

  private db() {
    return this.supabase.admin;
  }

  private async requireFacilityEmployee(profileId: string) {
    const { data: employee, error: employeeError } = await this.db()
      .from("facility_employees")
      .select("id,facility_id,profile_id,employee_role,is_active")
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .maybeSingle();

    if (employeeError || !employee) {
      throw new ForbiddenException("Active facility employee access required");
    }

    const { data: facility, error: facilityError } = await this.db()
      .from("facilities")
      .select("id,name,address,is_active")
      .eq("id", employee.facility_id)
      .maybeSingle();
    if (facilityError || !facility?.is_active) {
      throw new ForbiddenException("Active facility required");
    }
    return {
      facilityId: employee.facility_id,
      role: employee.employee_role,
      facility,
    };
  }

  async dashboard(profileId: string) {
    const access = await this.requireFacilityEmployee(profileId);
    const { data: orders, error } = await this.db()
      .from("orders")
      .select("id,order_number,current_status,created_at,updated_at")
      .eq("facility_id", access.facilityId)
      .in("current_status", [
        "in_transit_to_facility",
        "received_at_facility",
        "verification",
        "processing",
        "quality_check",
        "rework_required",
        "ready_for_delivery",
        "delivery_assigned",
        "delivery_failed",
      ])
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException("Facility dashboard unavailable");
    const queue = orders ?? [];

    const incomingOrderIds = queue
      .filter((order) => order.current_status === "in_transit_to_facility")
      .map((order) => order.id);

    const readyOrderIds = queue
      .filter((order) =>
        ["ready_for_delivery", "delivery_assigned", "delivery_failed"].includes(
          order.current_status,
        ),
      )
      .map((order) => order.id);

    const processingOrderIds = queue
      .filter((order) =>
        ["verification", "processing", "quality_check", "rework_required"].includes(
          order.current_status,
        ),
      )
      .map((order) => order.id);

    const pickupAssignmentByOrder = new Map<string, any>();
    const deliveryAssignmentByOrder = new Map<string, any>();
    const driverNames = new Map<string, string>();
    const processingStages = new Map<string, string>();
    const handedOverOrders = new Map<string, string>();
    const collectedOrders = new Map<string, string>();

    const neededDriverIds: string[] = [];

    // Load pickup assignments for incoming orders
    if (incomingOrderIds.length) {
      const { data: pickupAssignments } = await this.db()
        .from("driver_assignments")
        .select("id,order_id,driver_id,status,assigned_at")
        .eq("assignment_type", "pickup")
        .in("order_id", incomingOrderIds)
        .order("assigned_at", { ascending: false });

      for (const assignment of pickupAssignments ?? []) {
        if (!pickupAssignmentByOrder.has(assignment.order_id)) {
          pickupAssignmentByOrder.set(assignment.order_id, assignment);
          neededDriverIds.push(assignment.driver_id);
        }
      }
    }

    // Load delivery assignments & dispatch events for ready orders
    if (readyOrderIds.length) {
      const [assignmentResult, operationsResult] = await Promise.all([
        this.db()
          .from("driver_assignments")
          .select("id,order_id,driver_id,status,assigned_at,rejection_reason")
          .eq("assignment_type", "delivery")
          .in("order_id", readyOrderIds)
          .order("assigned_at", { ascending: false }),
        this.db()
          .from("driver_navigation_events")
          .select("order_id,event_type,created_at")
          .in("order_id", readyOrderIds)
          .in("event_type", ["facility_dispatch", "driver_collection_confirmed"]),
      ]);

      if (assignmentResult.error) {
        throw new BadRequestException("Facility delivery assignments unavailable");
      }

      const assignments = assignmentResult.data ?? [];
      for (const assignment of assignments) {
        if (!deliveryAssignmentByOrder.has(assignment.order_id)) {
          deliveryAssignmentByOrder.set(assignment.order_id, assignment);
          neededDriverIds.push(assignment.driver_id);
        }
      }

      for (const op of operationsResult.data ?? []) {
        if (op.event_type === "facility_dispatch") {
          handedOverOrders.set(op.order_id, op.created_at);
        } else if (op.event_type === "driver_collection_confirmed") {
          collectedOrders.set(op.order_id, op.created_at);
        }
      }
    }

    // Load operations to determine stage for processing orders
    if (processingOrderIds.length) {
      const { data: operations } = await this.db()
        .from("facility_order_operations")
        .select("order_id,operation_type,current_status,started_at,completed_at")
        .in("order_id", processingOrderIds)
        .order("started_at", { ascending: false });

      for (const op of operations ?? []) {
        if (!processingStages.has(op.order_id)) {
          processingStages.set(op.order_id, op.operation_type || op.current_status);
        }
      }
    }

    // Resolve driver profile names in batch
    const uniqueDriverIds = [...new Set(neededDriverIds)];
    if (uniqueDriverIds.length) {
      const { data: drivers } = await this.db()
        .from("drivers")
        .select("id,profile_id,profiles(full_name)")
        .in("id", uniqueDriverIds);
      for (const driver of (drivers as any[]) ?? []) {
        if (driver.profiles?.full_name) {
          driverNames.set(driver.id, driver.profiles.full_name);
        }
      }
    }

    const dashboardOrders = queue.map((order) => {
      const deliveryAssignment = deliveryAssignmentByOrder.get(order.id);
      const pickupAssignment = pickupAssignmentByOrder.get(order.id);
      const pickupDriverName = pickupAssignment
        ? driverNames.get(pickupAssignment.driver_id) || "Assigned Driver"
        : null;

      return {
        ...order,
        pickupDriverName,
        pickupAssignment: pickupAssignment
          ? {
              id: pickupAssignment.id,
              driverId: pickupAssignment.driver_id,
              driverName: pickupDriverName,
              status: pickupAssignment.status,
            }
          : null,
        processingStage: processingStages.get(order.id) ?? (order.current_status === "verification" ? "verification" : null),
        deliveryAssignment: deliveryAssignment
          ? {
              id: deliveryAssignment.id,
              driverId: deliveryAssignment.driver_id,
              driverName: driverNames.get(deliveryAssignment.driver_id) || "Assigned Driver",
              status: deliveryAssignment.status,
              rejectionReason: deliveryAssignment.rejection_reason ?? null,
              handedOver: handedOverOrders.has(order.id),
              handedOverAt: handedOverOrders.get(order.id) ?? null,
              collected: collectedOrders.has(order.id),
              collectedAt: collectedOrders.get(order.id) ?? null,
            }
          : null,
      };
    });

    return {
      facility: {
        id: access.facility.id,
        name: access.facility.name,
        address: access.facility.address,
      },
      role: access.role,
      summary: {
        incoming: queue.filter(
          (order) => order.current_status === "in_transit_to_facility",
        ).length,
        received: queue.filter(
          (order) => order.current_status === "received_at_facility",
        ).length,
        processing: queue.filter((order) =>
          ["verification", "processing", "quality_check", "rework_required"].includes(
            order.current_status,
          ),
        ).length,
        ready: queue.filter((order) =>
          ["ready_for_delivery", "delivery_assigned", "delivery_failed"].includes(
            order.current_status,
          ),
        ).length,
      },
      orders: dashboardOrders,
    };
  }

  async availableDeliveryDrivers(profileId: string, orderId: string) {
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    if (order.current_status !== "delivery_failed") {
      throw new ConflictException(
        "A rejected delivery assignment is required before reassignment",
      );
    }
    const { data: history, error: historyError } = await this.db()
      .from("driver_assignments")
      .select("driver_id,status")
      .eq("order_id", orderId)
      .eq("assignment_type", "delivery");
    if (historyError) {
      throw new BadRequestException("Unable to load assignment history");
    }
    const excluded = new Set((history ?? []).map((row) => row.driver_id));
    const { data: candidates, error: candidateError } = await this.db().rpc(
      "find_driver_assignment_candidates",
      { p_order_id: orderId, p_assignment_type: "delivery", p_limit: 50 },
    );
    if (candidateError) {
      throw new BadRequestException("Unable to load available drivers");
    }
    const candidateRows = (candidates ?? []).filter(
      (row: DeliveryDriverCandidate) => !excluded.has(row.driver_id),
    );
    const driverIds = candidateRows.map(
      (row: DeliveryDriverCandidate) => row.driver_id,
    );
    if (!driverIds.length) return { drivers: [] };
    const { data: drivers, error: driverError } = await this.db()
      .from("drivers")
      .select("id,profile_id,is_active,is_available,max_concurrent_jobs")
      .in("id", driverIds);
    if (driverError) {
      throw new BadRequestException("Unable to load available drivers");
    }
    const eligible = (drivers ?? []).filter(
      (driver) => driver.is_active && driver.is_available,
    );
    const profileIds = eligible.map((driver) => driver.profile_id);
    const { data: profiles, error: profileError } = profileIds.length
      ? await this.db()
          .from("profiles")
          .select("id,full_name")
          .in("id", profileIds)
      : { data: [], error: null };
    if (profileError) {
      throw new BadRequestException("Unable to load available drivers");
    }
    const names = new Map((profiles ?? []).map((row) => [row.id, row.full_name]));
    const byId = new Map(eligible.map((driver) => [driver.id, driver]));
    return {
      drivers: candidateRows
        .filter((candidate: DeliveryDriverCandidate) => {
          const driver = byId.get(candidate.driver_id);
          return (
            driver &&
            Number(candidate.active_workload ?? 0) <
              Number(driver.max_concurrent_jobs ?? 0)
          );
        })
        .map((candidate: DeliveryDriverCandidate) => {
          const driver = byId.get(candidate.driver_id)!;
          return {
            id: driver.id,
            name: names.get(driver.profile_id) || "Driver",
            activeJobs: Number(candidate.active_workload ?? 0),
          };
        }),
    };
  }

  async handoverToDriver(
    profileId: string,
    orderId: string,
    targetDriverId?: string,
  ) {
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);

    if (
      !["ready_for_delivery", "delivery_assigned", "delivery_accepted"].includes(
        order.current_status,
      )
    ) {
      throw new ConflictException(
        `Handover is not allowed while order is ${order.current_status}`,
      );
    }

    const { data: assignment, error: assignmentError } = await this.db()
      .from("driver_assignments")
      .select("id,driver_id,status")
      .eq("order_id", orderId)
      .eq("assignment_type", "delivery")
      .in("status", ["assigned", "accepted", "en_route", "arrived"])
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assignmentError || !assignment) {
      throw new NotFoundException(
        "No active delivery assignment found for this order",
      );
    }

    if (targetDriverId && assignment.driver_id !== targetDriverId) {
      throw new ConflictException(
        "Assigned driver does not match the handover driver",
      );
    }

    const { data: existingOp } = await this.db()
      .from("driver_navigation_events")
      .select("id,created_at")
      .eq("order_id", orderId)
      .eq("event_type", "facility_dispatch")
      .maybeSingle();

    if (existingOp) {
      return {
        orderId,
        handedOver: true,
        driverId: assignment.driver_id,
        handedOverAt: existingOp.created_at,
        message: "Order was already handed over to driver",
      };
    }

    const now = new Date().toISOString();
    const { error: insertError } = await this.db()
      .from("driver_navigation_events")
      .insert({
        order_id: orderId,
        driver_id: assignment.driver_id,
        event_type: "facility_dispatch",
      });

    if (insertError) {
      throw new BadRequestException(insertError.message);
    }

    return {
      orderId,
      handedOver: true,
      driverId: assignment.driver_id,
      handedOverAt: now,
    };
  }

  async reassignDelivery(
    profileId: string,
    orderId: string,
    newDriverId: string,
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newDriverId)) {
      throw new BadRequestException("A valid replacement Driver is required");
    }
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    if (order.current_status !== "delivery_failed") {
      throw new ConflictException(
        "A rejected delivery assignment is required before reassignment",
      );
    }
    const { data, error } = await this.db().rpc(
      "facility_reassign_delivery_atomic",
      {
        p_profile_id: profileId,
        p_order_id: orderId,
        p_new_driver_id: newDriverId,
      },
    );
    if (error?.code === "42501") {
      throw new ForbiddenException(error.message);
    }
    if (error?.code === "P0002") {
      throw new NotFoundException(error.message);
    }
    if (error || !data?.assignment) {
      throw new ConflictException(error?.message ?? "Unable to reassign delivery");
    }
    return data;
  }

  private async requireOrder(orderId: string) {
    const { data, error } = await this.db()
      .from("orders")
      .select("id,facility_id,current_status")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException("Order not found");
    }

    return data;
  }

  private ensureFacilityMatch(
    access: {
      facilityId: string | null;
    },
    orderFacilityId: string | null,
  ) {
    if (access.facilityId !== orderFacilityId) {
      throw new ForbiddenException("Order belongs to another facility");
    }
  }

  private async operationForOrder(orderId: string) {
    const { data, error } = await this.db()
      .from("facility_order_operations")
      .select("*")
      .eq("order_id", orderId)
      .order("started_at", {
        ascending: false,
        nullsFirst: false,
      })
      .order("id", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data;
  }

  private throwProcessingRpcError(
    error:
      | {
          code?: string;
          message?: string;
        }
      | null
      | undefined,
    fallback: string,
  ): never {
    const message = error?.message ?? fallback;

    if (error?.code === "P0002") {
      throw new NotFoundException(message);
    }

    if (error?.code === "42501") {
      throw new ForbiddenException(message);
    }

    if (["23505", "23514", "40001"].includes(error?.code ?? "")) {
      throw new ConflictException(message);
    }

    throw new BadRequestException(message);
  }

  private async receiptCandidate(profileId: string, token: string) {
    const access = await this.requireFacilityEmployee(profileId);
    if (
      typeof token !== "string" ||
      !/^(?:BW1:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token.trim(),
      )
    ) {
      throw new BadRequestException("Valid handoff code is required");
    }
    const secureToken = token.trim().replace(/^BW1:/, "");
    const { data: qr, error: qrError } = await this.db()
      .from("order_qr_codes")
      .select("id,order_id,is_active")
      .eq("secure_token", secureToken)
      .maybeSingle();
    if (qrError || !qr?.is_active)
      throw new NotFoundException("Invalid QR code");
    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,order_number,facility_id,current_status,created_at")
      .eq("id", qr.order_id)
      .maybeSingle();
    if (orderError || !order) throw new NotFoundException("Order not found");
    this.ensureFacilityMatch(access, order.facility_id);
    if (order.current_status !== "in_transit_to_facility") {
      throw new ConflictException(
        `Facility receipt is not allowed while order is ${order.current_status}`,
      );
    }
    return { access, qr, order, secureToken };
  }

  private async receiptCandidateByOrderNumber(
    profileId: string,
    rawOrderNumber: string,
  ) {
    const access = await this.requireFacilityEmployee(profileId);
    const orderNumber = rawOrderNumber?.trim().toUpperCase();
    if (!/^BW-[A-Z0-9-]{6,40}$/.test(orderNumber ?? "")) {
      throw new BadRequestException("Valid B&W order ID is required");
    }
    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,order_number,facility_id,current_status,created_at")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (orderError || !order) throw new NotFoundException("Order not found");
    this.ensureFacilityMatch(access, order.facility_id);
    if (order.current_status !== "in_transit_to_facility") {
      throw new ConflictException(
        `Facility receipt is not allowed while order is ${order.current_status}`,
      );
    }
    const { data: qr, error: qrError } = await this.db()
      .from("order_qr_codes")
      .select("id,order_id,is_active,secure_token")
      .eq("order_id", order.id)
      .eq("is_active", true)
      .maybeSingle();
    if (qrError || !qr?.secure_token) {
      throw new NotFoundException("Active order handoff record not found");
    }
    return { access, qr, order, secureToken: qr.secure_token };
  }

  private async receiptPreview(
    access: { facility: { id: string; name: string } },
    order: {
      id: string;
      order_number: string;
      current_status: string;
    },
  ) {
    const { data: items, error } = await this.db()
      .from("order_items")
      .select("item_name,quantity,weight_kg")
      .eq("order_id", order.id);
    if (error)
      throw new BadRequestException("Order intake details unavailable");
    return {
      orderId: order.id,
      orderNumber: order.order_number,
      orderStatus: order.current_status,
      facility: { id: access.facility.id, name: access.facility.name },
      items: items ?? [],
    };
  }

  async previewReceipt(profileId: string, token: string) {
    const { access, order } = await this.receiptCandidate(profileId, token);
    return this.receiptPreview(access, order);
  }

  async previewReceiptByOrderNumber(profileId: string, orderNumber: string) {
    const { access, order } = await this.receiptCandidateByOrderNumber(
      profileId,
      orderNumber,
    );
    return this.receiptPreview(access, order);
  }

  async receiveByQr(
    profileId: string,
    token: string,
    latitude?: number,
    longitude?: number,
  ) {
    const { secureToken } = await this.receiptCandidate(profileId, token);

    const { data: receipt, error: receiptError } = await this.db().rpc(
      "receive_facility_order_atomic",
      {
        p_secure_token: secureToken,
        p_scanner_profile_id: profileId,
        p_latitude: latitude ?? null,
        p_longitude: longitude ?? null,
      },
    );

    if (receiptError || !receipt) {
      throw new BadRequestException(
        receiptError?.message ?? "Unable to receive order at facility",
      );
    }

    return {
      orderId: receipt.orderId,
      operationId: receipt.operationId,
      facilityStatus: receipt.facilityStatus,
      orderStatus: receipt.orderStatus,
      pickupAssignmentStatus: receipt.pickupAssignmentStatus,
      received: receipt.received,
    };
  }

  async receiveByOrderNumber(
    profileId: string,
    orderNumber: string,
    latitude?: number,
    longitude?: number,
  ) {
    const { secureToken } = await this.receiptCandidateByOrderNumber(
      profileId,
      orderNumber,
    );
    return this.receiveByQr(
      profileId,
      `BW1:${secureToken}`,
      latitude,
      longitude,
    );
  }

  async verifyOrder(
    profileId: string,
    orderId: string,
    body: {
      itemCount?: number;
      weightKg?: number;
      notes?: string;
    },
  ) {
    const access = await this.requireFacilityEmployee(profileId);

    const order = await this.requireOrder(orderId);

    this.ensureFacilityMatch(access, order.facility_id);

    if (order.current_status !== "received_at_facility") {
      throw new ConflictException(
        `Verification is not allowed while order is ${order.current_status}`,
      );
    }

    const operation = await this.operationForOrder(orderId);

    if (!operation) {
      throw new ConflictException("Facility operation has not been created");
    }

    if (operation.current_status !== "received") {
      throw new ConflictException(
        `Facility operation is already ${operation.current_status}`,
      );
    }

    const { data: verification, error: verificationError } =
      await this.db().rpc("record_facility_verification_atomic", {
        p_order_id: orderId,
        p_performed_by: profileId,
        p_item_count: body.itemCount ?? null,
        p_weight_kg: body.weightKg ?? null,
        p_notes: body.notes ?? null,
      });

    if (verificationError || !verification) {
      throw new BadRequestException(
        verificationError?.message ?? "Unable to record facility verification",
      );
    }

    return {
      orderId,
      operationId: verification.operationId,
      verified: true,
      facilityStatus: "verification",
      orderStatus: "verification",
    };
  }

  async intakeDetails(profileId: string, orderId: string) {
    const access = await this.requireFacilityEmployee(profileId);
    const { data: order, error: orderError } = await this.db()
      .from("orders")
      .select("id,order_number,facility_id,current_status")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) throw new NotFoundException("Order not found");
    this.ensureFacilityMatch(access, order.facility_id);
    const [items, inspections, discrepancies] = await Promise.all([
      this.db()
        .from("order_items")
        .select("id,item_name,quantity,weight_kg")
        .eq("order_id", orderId)
        .order("id"),
      this.db()
        .from("garment_inspections")
        .select(
          "id,order_item_id,counted_quantity,weight_kg,condition_notes,created_at",
        )
        .eq("order_id", orderId)
        .not("order_item_id", "is", null)
        .order("created_at"),
      this.db()
        .from("facility_intake_discrepancies")
        .select(
          "id,order_item_id,kind,expected_quantity,counted_quantity,expected_weight_kg,measured_weight_kg,notes,status,created_at,resolved_at,resolution_notes",
        )
        .eq("order_id", orderId)
        .order("created_at"),
    ]);
    if (items.error || inspections.error || discrepancies.error) {
      throw new BadRequestException("Facility intake details unavailable");
    }
    return {
      orderId,
      orderNumber: order.order_number,
      orderStatus: order.current_status,
      facility: { id: access.facility.id, name: access.facility.name },
      role: access.role,
      items: items.data ?? [],
      inspections: inspections.data ?? [],
      discrepancies: discrepancies.data ?? [],
    };
  }

  async verifyIntake(
    profileId: string,
    orderId: string,
    body: VerifyIntakeDto,
  ) {
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    if (order.current_status !== "received_at_facility") {
      throw new ConflictException(
        `Verification is not allowed while order is ${order.current_status}`,
      );
    }
    let data = null;
    const { data: intakeRes, error: intakeErr } = await this.db().rpc(
      "record_facility_intake_verification_atomic",
      {
        p_order_id: orderId,
        p_performed_by: profileId,
        p_items: body.items,
        p_notes: body.notes?.trim() || null,
      },
    );
    if (intakeErr && intakeErr.code === "PGRST202") {
      const totalCount = (body.items || []).reduce(
        (sum, item) => sum + (Number(item.countedQuantity) || 0),
        0,
      );
      const totalWeight = (body.items || []).reduce(
        (sum, item) => sum + (Number(item.weightKg) || 0),
        0,
      );
      const { data: verRes, error: verErr } = await this.db().rpc(
        "record_facility_verification_atomic",
        {
          p_order_id: orderId,
          p_performed_by: profileId,
          p_item_count: totalCount || null,
          p_weight_kg: totalWeight || null,
          p_notes: body.notes?.trim() || null,
        },
      );
      if (verErr || !verRes) {
        this.throwProcessingRpcError(verErr, "Unable to verify Facility intake");
      }
      data = { ...verRes, discrepancyCount: 0 };
    } else if (intakeErr || !intakeRes) {
      this.throwProcessingRpcError(intakeErr, "Unable to verify Facility intake");
    } else {
      data = intakeRes;
    }

    return {
      orderId,
      operationId: data.operationId,
      verified: true,
      orderStatus: data.orderStatus,
      discrepancyCount: data.discrepancyCount ?? 0,
    };
  }

  async resolveIntakeDiscrepancy(
    profileId: string,
    orderId: string,
    discrepancyId: string,
    notes: string,
  ) {
    const access = await this.requireFacilityEmployee(profileId);
    if (access.role !== "manager")
      throw new ForbiddenException("Facility manager access required");
    if (!notes?.trim())
      throw new BadRequestException("Resolution notes are required");
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    const { data, error } = await this.db()
      .from("facility_intake_discrepancies")
      .update({
        status: "resolved",
        resolved_by: profileId,
        resolved_at: new Date().toISOString(),
        resolution_notes: notes.trim(),
      })
      .eq("id", discrepancyId)
      .eq("order_id", orderId)
      .eq("status", "open")
      .select("id,status,resolved_at,resolution_notes")
      .maybeSingle();
    if (error || !data)
      throw new ConflictException("Open Facility intake discrepancy not found");
    return data;
  }

  async processingHistory(profileId: string, orderId: string) {
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    const { data, error } = await this.db()
      .from("facility_order_operations")
      .select(
        "id,operation_type,current_status,started_at,completed_at,performed_by,notes",
      )
      .eq("order_id", orderId)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      throw new BadRequestException(
        error.message || "Facility processing history unavailable",
      );
    }
    const stages = (data ?? [])
      .filter((operation) =>
        ["washing", "drying", "ironing", "folding", "packaging"].includes(
          operation.operation_type,
        ),
      )
      .map((operation) => ({
        id: operation.id,
        operation_type: operation.operation_type,
        current_status: operation.current_status,
        started_at: operation.started_at,
        completed_at: operation.completed_at,
        started_by: operation.performed_by,
        completed_by: operation.completed_at ? operation.performed_by : null,
        performed_by: operation.performed_by,
        rewash_cycle: 0,
      }));
    const active = stages.find((operation) => !operation.completed_at);
    const completed = stages.filter((operation) => operation.completed_at);
    const next: Record<string, string> = {
      verification: "washing",
      washing: "drying",
      drying: "ironing",
      ironing: "folding",
      folding: "packaging",
    };
    const latest = stages[stages.length - 1];
    const expectedStage = active
      ? null
      : ["verification", "rework_required"].includes(order.current_status)
        ? "washing"
        : order.current_status === "processing" && latest?.completed_at
          ? (next[latest.operation_type] ?? null)
          : null;
    const { count: openCount, error: discrepancyError } = await this.db()
      .from("facility_intake_discrepancies")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("status", "open");
    if (discrepancyError) {
      throw new BadRequestException(
        discrepancyError.message || "Facility discrepancy status unavailable",
      );
    }
    const { data: decisions, error: qcError } = await this.db()
      .from("facility_qc_decisions")
      .select(
        "id,operation_id,cycle_number,approved,rewash_required,defect_code,reason,affected_item_ids,decided_by,created_at",
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (qcError) {
      throw new BadRequestException(
        qcError.message || "Facility QC history unavailable",
      );
    }
    const qcOperations = (data ?? []).filter(
      (operation) => operation.operation_type === "quality_check",
    );
    const resolvedDecisions =
      decisions && decisions.length > 0
        ? decisions
        : qcOperations.map((op, idx) => ({
            id: op.id,
            operation_id: op.id,
            cycle_number: idx,
            approved:
              op.current_status === "ready_for_delivery" ||
              [
                "ready_for_delivery",
                "delivery_assigned",
                "delivery_accepted",
                "en_route_delivery",
                "delivery_otp_pending",
                "delivered",
                "claim_period_active",
              ].includes(order.current_status),
            rewash_required: op.current_status === "rework_required",
            defect_code: null,
            reason:
              op.notes ||
              (op.current_status === "ready_for_delivery"
                ? "Quality check approved"
                : null),
            affected_item_ids: [],
            decided_by: op.performed_by,
            created_at: op.completed_at || op.started_at,
          }));
    return {
      orderId,
      orderStatus: order.current_status,
      stages,
      qualityDecisions: resolvedDecisions,
      role: access.role,
      rewashCycle: resolvedDecisions.filter((decision) => !decision.approved)
        .length,
      canQualityCheck:
        order.current_status === "processing" &&
        latest?.operation_type === "packaging" &&
        !!latest.completed_at &&
        !openCount,
      activeOperationId: active?.id ?? null,
      nextStage: openCount ? null : expectedStage,
      openDiscrepancies: openCount ?? 0,
      completedStageCount: completed.length,
    };
  }

  async packingDetails(profileId: string, orderId: string) {
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    const latest = await this.operationForOrder(orderId);
    const { data: verification, error: verificationError } = await this.db()
      .from("facility_order_operations")
      .select("id")
      .eq("order_id", orderId)
      .eq("operation_type", "verification")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verificationError)
      throw new BadRequestException("Facility verification unavailable");
    const [items, inspections, packings, policy] = await Promise.all([
      this.db()
        .from("order_items")
        .select("id,item_name,quantity")
        .eq("order_id", orderId)
        .order("id"),
      this.db()
        .from("garment_inspections")
        .select("order_item_id,counted_quantity")
        .eq(
          "operation_id",
          verification?.id ?? "00000000-0000-0000-0000-000000000000",
        )
        .not("order_item_id", "is", null),
      this.db()
        .from("facility_packings")
        .select("id,parcel_id,cycle_number,packed_by,packed_at,notes")
        .eq("order_id", orderId)
        .order("cycle_number", { ascending: true }),
      this.db()
        .from("facility_packing_policy_orders")
        .select("order_id")
        .eq("order_id", orderId)
        .maybeSingle(),
    ]);
    if (items.error || inspections.error || packings.error || policy.error) {
      throw new BadRequestException("Facility packing unavailable");
    }
    const verified = new Map(
      (inspections.data ?? []).map((row) => [
        row.order_item_id,
        row.counted_quantity,
      ]),
    );
    const packingIds = (packings.data ?? []).map((row) => row.id);
    const packedRows = packingIds.length
      ? await this.db()
          .from("facility_packing_items")
          .select("packing_id,order_item_id,verified_quantity,packed_quantity")
          .in("packing_id", packingIds)
      : { data: [], error: null };
    if (packedRows.error)
      throw new BadRequestException("Facility packing items unavailable");
    const history = (packings.data ?? []).map((packing) => ({
      ...packing,
      items: (packedRows.data ?? []).filter(
        (item) => item.packing_id === packing.id,
      ),
    }));
    return {
      orderId,
      orderStatus: order.current_status,
      facility: access.facility.name,
      packingRequired: !!policy.data,
      cycleNumber: latest?.rewash_cycle ?? 0,
      canPack:
        order.current_status === "processing" &&
        latest?.operation_type === "packaging" &&
        !!latest.completed_at &&
        !!verification &&
        (items.data ?? []).length > 0 &&
        (items.data ?? []).every((item) => verified.has(item.id)) &&
        !history.some(
          (packing) => packing.cycle_number === latest.rewash_cycle,
        ),
      items: (items.data ?? []).map((item) => ({
        ...item,
        verifiedQuantity: verified.get(item.id) ?? null,
      })),
      history,
    };
  }

  async confirmPacking(
    profileId: string,
    orderId: string,
    body: {
      parcelId?: string;
      items: Array<{ orderItemId: string; packedQuantity: number }>;
      notes?: string;
    },
  ) {
    const access = await this.requireFacilityEmployee(profileId);
    const order = await this.requireOrder(orderId);
    this.ensureFacilityMatch(access, order.facility_id);
    if (order.current_status !== "processing") {
      throw new ConflictException(
        `Packing is not allowed while order is ${order.current_status}`,
      );
    }
    const { data, error } = await this.db().rpc(
      "confirm_facility_packing_atomic",
      {
        p_order_id: orderId,
        p_performed_by: profileId,
        p_parcel_id:
          body.parcelId?.trim().toUpperCase() ||
          `BW-${orderId.slice(0, 8).toUpperCase()}-${Date.now()}`,
        p_items: body.items,
        p_notes: body.notes?.trim() || null,
      },
    );
    if (error || !data)
      this.throwProcessingRpcError(error, "Unable to confirm packing");
    return data;
  }

  async startProcessing(
    profileId: string,
    orderId: string,
    processType: string,
    machineId?: string,
  ) {
    const access = await this.requireFacilityEmployee(profileId);

    const order = await this.requireOrder(orderId);

    this.ensureFacilityMatch(access, order.facility_id);

    if (
      !["verification", "processing", "rework_required"].includes(
        order.current_status,
      )
    ) {
      throw new ConflictException(
        `Processing is not allowed while order is ${order.current_status}`,
      );
    }

    const operation = await this.operationForOrder(orderId);

    if (!operation) {
      throw new ConflictException("Facility operation not found");
    }

    const allowedProcesses = [
      "washing",
      "drying",
      "ironing",
      "folding",
      "packaging",
    ];

    if (!allowedProcesses.includes(processType)) {
      throw new BadRequestException(
        `Invalid process type. Allowed: ${allowedProcesses.join(", ")}`,
      );
    }

    if (
      allowedProcesses.includes(operation.current_status) &&
      !operation.completed_at
    ) {
      throw new ConflictException(
        `Facility stage ${operation.current_status} is still in progress`,
      );
    }

    const nextStage: Record<string, string> = {
      verification: "washing",
      washing: "drying",
      drying: "ironing",
      ironing: "folding",
      folding: "packaging",
      rework_required: "washing",
    };
    const expectedProcess = nextStage[operation.current_status];

    if (!expectedProcess) {
      throw new ConflictException(
        `Processing cannot start from facility status ${operation.current_status}`,
      );
    }

    if (processType !== expectedProcess) {
      throw new ConflictException(
        `Expected facility stage ${expectedProcess}, received ${processType}`,
      );
    }

    if (machineId) {
      const { data: machine, error: machineError } = await this.db()
        .from("facility_machines")
        .select("id,facility_id,status")
        .eq("id", machineId)
        .maybeSingle();

      if (machineError || !machine) {
        throw new NotFoundException("Machine not found");
      }

      if (machine.facility_id !== order.facility_id) {
        throw new ForbiddenException("Machine belongs to another facility");
      }

      if (!["active", "idle"].includes(machine.status)) {
        throw new ConflictException(
          `Machine is not available: ${machine.status}`,
        );
      }
    }

    const { data: created, error } = await this.db().rpc(
      "start_facility_processing_atomic",
      {
        p_order_id: orderId,
        p_performed_by: profileId,
        p_process_type: processType,
        p_machine_id: machineId ?? null,
      },
    );

    if (error || !created) {
      this.throwProcessingRpcError(error, "Unable to start processing");
    }

    return {
      ...created,
      operationId: created.operationId ?? created.id,
      previousFacilityStatus:
        created.previousFacilityStatus ?? operation.current_status,
      facilityStatus: created.facilityStatus ?? processType,
      orderStatus: created.orderStatus ?? "processing",
    };
  }

  async completeProcessing(profileId: string, operationId: string) {
    const access = await this.requireFacilityEmployee(profileId);

    const { data: operation, error } = await this.db()
      .from("facility_order_operations")
      .select("*")
      .eq("id", operationId)
      .maybeSingle();

    if (error || !operation) {
      throw new NotFoundException("Operation not found");
    }

    const order = await this.requireOrder(operation.order_id);

    this.ensureFacilityMatch(access, order.facility_id);

    if (order.current_status !== "processing") {
      throw new ConflictException(
        `Processing completion is not allowed while order is ${order.current_status}`,
      );
    }

    if (
      !["washing", "drying", "ironing", "folding", "packaging"].includes(
        operation.current_status,
      )
    ) {
      throw new ConflictException(
        `Facility status ${operation.current_status} is not an active processing stage`,
      );
    }

    const { data: updated, error: updateError } = await this.db().rpc(
      "complete_facility_processing_atomic",
      {
        p_operation_id: operationId,
        p_performed_by: profileId,
      },
    );

    if (updateError || !updated) {
      this.throwProcessingRpcError(
        updateError,
        "Unable to complete processing operation",
      );
    }

    return {
      ...updated,
      processingCompleted: true,
    };
  }

  async qualityCheck(
    profileId: string,
    orderId: string,
    approved: boolean,
    notes?: string,
    defectCode?: string,
    affectedItemIds?: string[],
  ) {
    const access = await this.requireFacilityEmployee(profileId);

    if (
      !approved &&
      (!["stain", "damage", "finish", "missing", "other"].includes(
        defectCode ?? "",
      ) ||
        !notes?.trim() ||
        notes.trim().length < 5)
    ) {
      throw new BadRequestException(
        "Failed QC requires defect category and reason",
      );
    }

    const order = await this.requireOrder(orderId);

    this.ensureFacilityMatch(access, order.facility_id);

    if (order.current_status !== "processing") {
      throw new ConflictException(
        `Quality check is not allowed while order is ${order.current_status}`,
      );
    }

    const operation = await this.operationForOrder(orderId);

    if (!operation) {
      throw new ConflictException("Facility operation not found");
    }

    if (
      operation.current_status !== "packaging" ||
      operation.operation_type !== "packaging" ||
      !operation.completed_at
    ) {
      throw new ConflictException(
        "Washing, drying, ironing, folding, and packaging must complete in order before quality check",
      );
    }

    let qualityOperation = null;
    const { data: qOp, error: qErr } = await this.db().rpc(
      "record_facility_qc_decision_atomic",
      {
        p_order_id: orderId,
        p_performed_by: profileId,
        p_approved: approved,
        p_defect_code: defectCode ?? null,
        p_reason: notes?.trim() || null,
        p_affected_item_ids: affectedItemIds ?? [],
      },
    );

    if (qErr && qErr.code === "PGRST202") {
      const { data: fbOp, error: fbErr } = await this.db().rpc(
        "complete_facility_quality_check_atomic",
        {
          p_order_id: orderId,
          p_performed_by: profileId,
          p_approved: approved,
          p_notes: notes?.trim() || null,
        },
      );
      if (fbErr || !fbOp) {
        this.throwProcessingRpcError(fbErr, "Unable to record quality check");
      }
      qualityOperation = {
        ...fbOp,
        rewashRequired: !approved,
        cycleNumber: 0,
      };
    } else if (qErr || !qOp) {
      this.throwProcessingRpcError(
        qErr,
        "Unable to record quality check",
      );
    } else {
      qualityOperation = qOp;
    }

    if (qualityOperation.orderStatus === "ready_for_delivery") {
      await this.triggerDeliveryAssignment(orderId);
    }

    return {
      orderId,
      operationId: qualityOperation.operationId,
      approved,
      rewashRequired: qualityOperation.rewashRequired,
      cycleNumber: qualityOperation.cycleNumber,
      facilityStatus: qualityOperation.facilityStatus,
      orderStatus: qualityOperation.orderStatus,
    };
  }
}
