import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { SupabaseService } from "../supabase/supabase.service";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "assigned",
  "accepted",
  "en_route",
  "arrived",
];
const RELEVANT_ORDER_STATUSES: Record<"pickup" | "delivery", string[]> = {
  pickup: [
    "pickup_assigned",
    "pickup_accepted",
    "en_route_pickup",
    "pickup_otp_pending",
    "picked_up",
    "in_transit_to_facility",
  ],
  delivery: [
    "delivery_assigned",
    "delivery_accepted",
    "en_route_delivery",
    "delivery_otp_pending",
  ],
};
const QR_PAYLOAD =
  /^BW1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ORDER_NUMBER = /^BW-[A-Z0-9-]{6,40}$/i;

function operationallyRelevant(
  type: "pickup" | "delivery",
  assignmentStatus: string,
  orderStatus: string,
) {
  return (
    ACTIVE_ASSIGNMENT_STATUSES.includes(assignmentStatus) &&
    RELEVANT_ORDER_STATUSES[type].includes(orderStatus)
  );
}

function todayWindow() {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00+05:30`);
  return {
    today,
    start: start.toISOString(),
    end: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

type Assignment = {
  id: string;
  order_id: string;
  driver_id: string;
  assignment_type: "pickup" | "delivery";
  status: string;
  assigned_at: string;
  accepted_at: string | null;
  completed_at: string | null;
};

@Injectable()
export class DriversService {
  constructor(private readonly supabase: SupabaseService) {}

  private async requireActiveDriver(profileId: string) {
    const { data, error } = await this.supabase.admin
      .from("drivers")
      .select("id,is_active,is_available,max_concurrent_jobs")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (error || !data?.is_active)
      throw new NotFoundException("Active driver profile not found");
    return data;
  }

  async dashboard(profileId: string) {
    const driver = await this.requireActiveDriver(profileId);
    const driverId = driver.id;
    const isAvailable = Boolean(driver.is_available);
    const maxConcurrent = driver.max_concurrent_jobs ?? 3;
    const { today, start, end } = todayWindow();
    const fields =
      "id,order_id,driver_id,assignment_type,status,assigned_at,accepted_at,completed_at";
    const [activeResult, todayResult, completedResult] = await Promise.all([
      this.supabase.admin
        .from("driver_assignments")
        .select(fields)
        .eq("driver_id", driverId)
        .in("status", ACTIVE_ASSIGNMENT_STATUSES)
        .order("assigned_at", { ascending: false })
        .limit(100),
      this.supabase.admin
        .from("driver_assignments")
        .select(fields)
        .eq("driver_id", driverId)
        .gte("assigned_at", start)
        .lt("assigned_at", end)
        .order("assigned_at", { ascending: false })
        .limit(100),
      this.supabase.admin
        .from("driver_assignments")
        .select(fields)
        .eq("driver_id", driverId)
        .eq("status", "completed")
        .gte("completed_at", start)
        .lt("completed_at", end)
        .order("completed_at", { ascending: false })
        .limit(100),
    ]);
    if (activeResult.error || todayResult.error || completedResult.error)
      throw new BadRequestException("Unable to load assignments");
    const unique = new Map<string, Assignment>();
    for (const assignment of [
      ...(activeResult.data ?? []),
      ...(todayResult.data ?? []),
      ...(completedResult.data ?? []),
    ] as Assignment[]) {
      if (assignment.driver_id !== driverId) continue;
      unique.set(assignment.id, assignment);
    }
    const assignments = [...unique.values()].filter(
      (item) =>
        ACTIVE_ASSIGNMENT_STATUSES.includes(item.status) ||
        item.status === "completed",
    );
    const orderIds = [...new Set(assignments.map((item) => item.order_id))];

    // Load available open jobs if driver is available and within capacity
    let availablePickups: any[] = [];
    let availableDeliveries: any[] = [];

    const activeCount = assignments.filter((item) =>
      ACTIVE_ASSIGNMENT_STATUSES.includes(item.status),
    ).length;

    if (isAvailable && activeCount < maxConcurrent) {
      const [pickupOrdersRes, deliveryOrdersRes, activeAssignmentsRes] =
        await Promise.all([
          this.supabase.admin
            .from("orders")
            .select(
              "id,order_number,current_status,pickup_scheduled_at,pickup_slot_label,pickup_address_id,delivery_address_id,facility_id",
            )
            .in("current_status", ["confirmed", "pickup_failed"])
            .order("created_at", { ascending: false })
            .limit(20),
          this.supabase.admin
            .from("orders")
            .select(
              "id,order_number,current_status,pickup_scheduled_at,pickup_slot_label,pickup_address_id,delivery_address_id,facility_id",
            )
            .in("current_status", ["ready_for_delivery", "delivery_failed"])
            .order("updated_at", { ascending: false })
            .limit(20),
          this.supabase.admin
            .from("driver_assignments")
            .select("order_id,assignment_type,status")
            .in("status", ACTIVE_ASSIGNMENT_STATUSES),
        ]);

      if (!pickupOrdersRes.error && !deliveryOrdersRes.error) {
        const activeAssignedOrderMap = new Set<string>();
        for (const da of activeAssignmentsRes.data ?? []) {
          activeAssignedOrderMap.add(`${da.order_id}:${da.assignment_type}`);
        }

        const candidatePickups = (pickupOrdersRes.data ?? []).filter(
          (o) => !activeAssignedOrderMap.has(`${o.id}:pickup`),
        );
        const candidateDeliveries = (deliveryOrdersRes.data ?? []).filter(
          (o) => !activeAssignedOrderMap.has(`${o.id}:delivery`),
        );

        const openOrderIds = [
          ...candidatePickups.map((o) => o.id),
          ...candidateDeliveries.map((o) => o.id),
        ];

        if (openOrderIds.length > 0) {
          const openAddressIds = [
            ...new Set(
              [...candidatePickups, ...candidateDeliveries].flatMap((o) =>
                [o.pickup_address_id, o.delivery_address_id].filter(Boolean),
              ),
            ),
          ];
          const openFacilityIds = [
            ...new Set(
              [...candidatePickups, ...candidateDeliveries]
                .map((o) => o.facility_id)
                .filter(Boolean),
            ),
          ];

          const [openAddressesRes, openFacilitiesRes] = await Promise.all([
            openAddressIds.length
              ? this.supabase.admin
                  .from("customer_addresses")
                  .select(
                    "id,label,address_line1,address_line2,city,state,postal_code,latitude,longitude",
                  )
                  .in("id", openAddressIds)
              : Promise.resolve({ data: [], error: null }),
            openFacilityIds.length
              ? this.supabase.admin
                  .from("facilities")
                  .select("id,name,address,latitude,longitude")
                  .in("id", openFacilityIds)
              : Promise.resolve({ data: [], error: null }),
          ]);

          const openAddresses = new Map(
            (openAddressesRes.data ?? []).map((row) => [row.id, row]),
          );
          const openFacilities = new Map(
            (openFacilitiesRes.data ?? []).map((row) => [row.id, row]),
          );

          availablePickups = candidatePickups.map((order) => ({
            id: order.id,
            orderId: order.id,
            orderNumber: order.order_number,
            type: "pickup",
            assignmentStatus: "available",
            orderStatus: order.current_status,
            pickupScheduledAt: order.pickup_scheduled_at,
            pickupSlotLabel: order.pickup_slot_label,
            address: order.pickup_address_id
              ? openAddresses.get(order.pickup_address_id) ?? null
              : null,
            facility: order.facility_id
              ? openFacilities.get(order.facility_id) ?? null
              : null,
          }));

          availableDeliveries = candidateDeliveries.map((order) => ({
            id: order.id,
            orderId: order.id,
            orderNumber: order.order_number,
            type: "delivery",
            assignmentStatus: "available",
            orderStatus: order.current_status,
            pickupScheduledAt: order.pickup_scheduled_at,
            pickupSlotLabel: order.pickup_slot_label,
            address: order.delivery_address_id
              ? openAddresses.get(order.delivery_address_id) ?? null
              : null,
            facility: order.facility_id
              ? openFacilities.get(order.facility_id) ?? null
              : null,
          }));
        }
      }
    }

    if (!orderIds.length) {
      return {
        date: today,
        summary: {
          pickups: 0,
          deliveries: 0,
          availablePickups: availablePickups.length,
          availableDeliveries: availableDeliveries.length,
          pending: 0,
          inProgress: 0,
          completed: 0,
        },
        availablePickups,
        availableDeliveries,
        pickups: [],
        deliveries: [],
      };
    }
    const { data: orders, error: ordersError } = await this.supabase.admin
      .from("orders")
      .select(
        "id,order_number,current_status,pickup_scheduled_at,pickup_slot_label,pickup_address_id,delivery_address_id,facility_id",
      )
      .in("id", orderIds);
    if (ordersError)
      throw new BadRequestException("Unable to load assigned orders");
    const orderMap = new Map((orders ?? []).map((order) => [order.id, order]));
    const addressIds = [
      ...new Set(
        (orders ?? []).flatMap((order) =>
          [order.pickup_address_id, order.delivery_address_id].filter(Boolean),
        ),
      ),
    ];
    const facilityIds = [
      ...new Set(
        (orders ?? []).map((order) => order.facility_id).filter(Boolean),
      ),
    ];
    const [addressResult, facilityResult] = await Promise.all([
      addressIds.length
        ? this.supabase.admin
            .from("customer_addresses")
            .select(
              "id,label,address_line1,address_line2,city,state,postal_code,latitude,longitude",
            )
            .in("id", addressIds)
        : Promise.resolve({ data: [], error: null }),
      facilityIds.length
        ? this.supabase.admin
            .from("facilities")
            .select("id,name,address,latitude,longitude")
            .in("id", facilityIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (addressResult.error || facilityResult.error)
      throw new BadRequestException("Unable to load job destinations");
    const addresses = new Map(
      (addressResult.data ?? []).map((row) => [row.id, row]),
    );
    const facilities = new Map(
      (facilityResult.data ?? []).map((row) => [row.id, row]),
    );
    const deliveryOrderIds = assignments
      .filter((a) => a.assignment_type === "delivery")
      .map((a) => a.order_id);

    const deliveryNavEventsMap = new Map<string, any[]>();
    if (deliveryOrderIds.length > 0) {
      const { data: navEvents } = await this.supabase.admin
        .from("driver_navigation_events")
        .select("order_id,event_type,created_at")
        .in("order_id", deliveryOrderIds)
        .in("event_type", [
          "navigate_facility",
          "arrived_at_facility",
          "facility_dispatch",
          "driver_collection_confirmed",
        ])
        .order("created_at", { ascending: true });

      for (const ev of navEvents ?? []) {
        const list = deliveryNavEventsMap.get(ev.order_id) ?? [];
        list.push(ev);
        deliveryNavEventsMap.set(ev.order_id, list);
      }
    }

    const jobs = assignments
      .map((assignment) => {
        const order = orderMap.get(assignment.order_id);
        if (!order) return null;
        let effectiveStatus = assignment.status;
        if (
          assignment.assignment_type === "delivery" &&
          assignment.status === "accepted"
        ) {
          const ops = deliveryNavEventsMap.get(assignment.order_id) ?? [];
          let inTransitToFacility = false;
          let arrivedAtFacility = false;
          let facilityCollected = false;
          for (const op of ops) {
            if (op.event_type === "navigate_facility") {
              inTransitToFacility = true;
            } else if (op.event_type === "arrived_at_facility") {
              arrivedAtFacility = true;
            } else if (op.event_type === "driver_collection_confirmed") {
              facilityCollected = true;
            }
          }
          if (!facilityCollected) {
            if (arrivedAtFacility) {
              effectiveStatus = "arrived";
            } else if (inTransitToFacility) {
              effectiveStatus = "en_route";
            }
          }
        }
        if (
          ACTIVE_ASSIGNMENT_STATUSES.includes(effectiveStatus) &&
          !operationallyRelevant(
            assignment.assignment_type,
            effectiveStatus,
            order.current_status,
          )
        )
          return null;
        const addressId =
          assignment.assignment_type === "pickup"
            ? order.pickup_address_id
            : order.delivery_address_id;
        return {
          id: assignment.id,
          orderId: order.id,
          orderNumber: order.order_number,
          type: assignment.assignment_type,
          assignmentStatus: effectiveStatus,
          orderStatus: order.current_status,
          assignedAt: assignment.assigned_at,
          acceptedAt: assignment.accepted_at,
          completedAt: assignment.completed_at,
          pickupScheduledAt: order.pickup_scheduled_at,
          pickupSlotLabel: order.pickup_slot_label,
          address: addressId ? (addresses.get(addressId) ?? null) : null,
          facility: order.facility_id
            ? (facilities.get(order.facility_id) ?? null)
            : null,
        };
      })
      .filter((job): job is NonNullable<typeof job> => job !== null)
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt) * -1);
    const activeJobs = jobs.filter(
      (job) => job.assignmentStatus !== "completed",
    );
    return {
      date: today,
      summary: {
        pickups: activeJobs.filter((job) => job.type === "pickup").length,
        deliveries: activeJobs.filter((job) => job.type === "delivery").length,
        availablePickups: availablePickups.length,
        availableDeliveries: availableDeliveries.length,
        pending: jobs.filter((job) => job.assignmentStatus === "assigned")
          .length,
        inProgress: jobs.filter((job) =>
          ["accepted", "en_route", "arrived"].includes(job.assignmentStatus),
        ).length,
        completed: jobs.filter((job) => job.assignmentStatus === "completed")
          .length,
      },
      availablePickups,
      availableDeliveries,
      pickups: activeJobs.filter((job) => job.type === "pickup"),
      deliveries: activeJobs.filter((job) => job.type === "delivery"),
    };
  }

  async claimJob(
    profileId: string,
    orderId: string,
    jobType: "pickup" | "delivery",
  ) {
    const driver = await this.requireActiveDriver(profileId);
    if (!driver.is_available) {
      throw new ConflictException("Driver is currently marked as unavailable");
    }

    // 1. Attempt direct claim RPC if present
    const { data: directData, error: directError } =
      await this.supabase.admin.rpc("claim_driver_job_atomic", {
        p_order_id: orderId,
        p_driver_id: driver.id,
        p_job_type: jobType,
      });

    if (!directError && directData?.assignment) {
      return {
        success: true,
        assignment: directData.assignment,
        orderStatus: directData.orderStatus,
      };
    }

    if (directError && directError.code !== "PGRST202" && !directError.message?.includes("schema cache")) {
      if (directError.code === "P0002") {
        throw new NotFoundException("Order not found");
      }
      if (directError.code === "23505") {
        throw new ConflictException(
          "This job has already been claimed by another driver.",
        );
      }
      throw new ConflictException(
        directError.message || "Job is no longer available",
      );
    }

    // 2. Authoritative atomic claim using existing Postgres RPCs
    const { data: created, error: createError } =
      await this.supabase.admin.rpc("create_driver_assignment_atomic", {
        p_order_id: orderId,
        p_driver_id: driver.id,
        p_assignment_type: jobType,
        p_assignment_score: 1.0,
      });

    if (createError) {
      if (createError.code === "P0002") {
        throw new NotFoundException("Order not found");
      }
      if (createError.code === "23505") {
        throw new ConflictException(
          "This job has already been claimed by another driver.",
        );
      }
      throw new ConflictException(
        createError.message || "Job is no longer available",
      );
    }

    if (!created?.assignment?.id) {
      throw new ConflictException("Unable to claim job");
    }

    const { data: accepted, error: acceptError } =
      await this.supabase.admin.rpc("transition_driver_assignment_atomic", {
        p_assignment_id: created.assignment.id,
        p_driver_id: driver.id,
        p_action: "accept",
        p_rejection_reason: null,
      });

    if (acceptError) {
      throw new ConflictException(
        acceptError.message || "Unable to complete job acceptance",
      );
    }

    const finalOrderStatus =
      accepted?.orderStatus ??
      (jobType === "pickup" ? "pickup_accepted" : "delivery_accepted");

    const claimPayload = {
      eventType: "JOB_CLAIMED",
      entityId: orderId,
      orderId,
      driverId: driver.id,
      jobType,
      status: finalOrderStatus,
      timestamp: new Date().toISOString(),
    };

    if (typeof this.supabase?.broadcastEvent === "function") {
      const { data: ord } = await this.supabase.admin
        .from("orders")
        .select("customer_id")
        .eq("id", orderId)
        .maybeSingle();

      const broadcasts: Promise<any>[] = [
        this.supabase.broadcastEvent("orders:all", "ORDER_STATUS_CHANGED", claimPayload),
        this.supabase.broadcastEvent("driver:available", "JOB_CLAIMED", claimPayload),
        this.supabase.broadcastEvent("jobs:drivers", "JOB_CLAIMED", claimPayload),
        this.supabase.broadcastEvent(`driver:${driver.id}`, "ASSIGNMENT_UPDATED", claimPayload),
        this.supabase.broadcastEvent("admin:operations", "ORDER_STATUS_CHANGED", claimPayload),
        this.supabase.broadcastEvent(`order:${orderId}`, "ORDER_STATUS_CHANGED", claimPayload),
      ];
      if (ord?.customer_id) {
        broadcasts.push(
          this.supabase.broadcastEvent(`customer:${ord.customer_id}`, "ORDER_STATUS_CHANGED", claimPayload),
        );
      }
      await Promise.allSettled(broadcasts);
    }

    return {
      success: true,
      assignment: accepted?.assignment ?? created.assignment,
      orderStatus: finalOrderStatus,
    };
  }

  async lookupOrder(profileId: string, rawCode: string) {
    const driver = await this.requireActiveDriver(profileId);
    const driverId = driver.id;
    const code = rawCode.trim();
    let order: {
      id: string;
      order_number: string;
      current_status: string;
    } | null = null;
    const qrMatch = code.match(QR_PAYLOAD);
    if (qrMatch) {
      const { data: qr, error: qrError } = await this.supabase.admin
        .from("order_qr_codes")
        .select("order_id,is_active")
        .eq("secure_token", qrMatch[1])
        .eq("is_active", true)
        .maybeSingle();
      if (qrError || !qr?.is_active)
        throw new NotFoundException("Assigned order not found");
      const { data, error } = await this.supabase.admin
        .from("orders")
        .select("id,order_number,current_status")
        .eq("id", qr.order_id)
        .maybeSingle();
      if (error)
        throw new BadRequestException("Unable to look up assigned order");
      order = data;
    } else if (ORDER_NUMBER.test(code)) {
      const { data, error } = await this.supabase.admin
        .from("orders")
        .select("id,order_number,current_status")
        .eq("order_number", code.toUpperCase())
        .maybeSingle();
      if (error)
        throw new BadRequestException("Unable to look up assigned order");
      order = data;
    } else {
      throw new BadRequestException(
        "Enter a valid B&W order number or scan an order QR",
      );
    }
    if (!order) throw new NotFoundException("Assigned order not found");
    const { data: assignment, error: assignmentError } =
      await this.supabase.admin
        .from("driver_assignments")
        .select("id,order_id,driver_id,assignment_type,status,assigned_at")
        .eq("order_id", order.id)
        .eq("driver_id", driverId)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (assignmentError)
      throw new BadRequestException("Unable to look up assigned order");
    if (
      !assignment ||
      !["assigned", "accepted", "en_route", "arrived", "completed"].includes(
        assignment.status,
      )
    ) {
      throw new NotFoundException("Assigned order not found");
    }
    if (
      assignment.status !== "completed" &&
      !operationallyRelevant(
        assignment.assignment_type,
        assignment.status,
        order.current_status,
      )
    ) {
      throw new ConflictException(
        "This assignment is not active for the order lifecycle",
      );
    }
    return {
      assignmentId: assignment.id,
      orderId: order.id,
      orderNumber: order.order_number,
      assignmentType: assignment.assignment_type,
      assignmentStatus: assignment.status,
      orderStatus: order.current_status,
    };
  }

  async assignment(profileId: string, assignmentId: string) {
    const driver = await this.requireActiveDriver(profileId);
    const driverId = driver.id;
    const { data: assignment, error } = await this.supabase.admin
      .from("driver_assignments")
      .select(
        "id,order_id,driver_id,assignment_type,status,assigned_at,accepted_at,completed_at",
      )
      .eq("id", assignmentId)
      .eq("driver_id", driverId)
      .maybeSingle();
    if (error || !assignment || assignment.driver_id !== driverId)
      throw new NotFoundException("Assignment not found");
    if (
      ["rejected", "reassignment_required", "cancelled", "expired"].includes(
        assignment.status,
      )
    ) {
      throw new NotFoundException("Assignment not found");
    }
    const { data: order, error: orderError } = await this.supabase.admin
      .from("orders")
      .select(
        "id,order_number,customer_id,facility_id,current_status,pickup_scheduled_at,pickup_slot_label,pickup_address_id,delivery_address_id",
      )
      .eq("id", assignment.order_id)
      .maybeSingle();
    if (orderError || !order)
      throw new NotFoundException("Assigned order not found");
    const addressId =
      assignment.assignment_type === "pickup"
        ? order.pickup_address_id
        : order.delivery_address_id;
    const [addressResult, facilityResult, itemsResult] = await Promise.all([
      addressId
        ? this.supabase.admin
            .from("customer_addresses")
            .select(
              "id,label,address_line1,address_line2,city,state,postal_code,latitude,longitude",
            )
            .eq("id", addressId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      order.facility_id
        ? this.supabase.admin
            .from("facilities")
            .select("id,name,address,latitude,longitude")
            .eq("id", order.facility_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      assignment.assignment_type === "pickup"
        ? this.supabase.admin
            .from("order_items")
            .select("id,item_name,quantity,weight_kg,customer_notes")
            .eq("order_id", order.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (addressResult.error || facilityResult.error || itemsResult.error)
      throw new BadRequestException("Unable to load job details");

    let facilityHandedOver = false;
    let facilityCollected = false;
    let facilityHandedOverAt: string | null = null;
    let facilityCollectedAt: string | null = null;
    let effectiveAssignmentStatus = assignment.status;

    if (assignment.assignment_type === "delivery") {
      const { data: ops } = await this.supabase.admin
        .from("driver_navigation_events")
        .select("event_type,created_at")
        .eq("order_id", order.id)
        .in("event_type", [
          "navigate_facility",
          "arrived_at_facility",
          "facility_dispatch",
          "driver_collection_confirmed",
        ])
        .order("created_at", { ascending: true });

      let inTransitToFacility = false;
      let arrivedAtFacility = false;

      for (const op of ops ?? []) {
        if (op.event_type === "navigate_facility") {
          inTransitToFacility = true;
        } else if (op.event_type === "arrived_at_facility") {
          arrivedAtFacility = true;
        } else if (op.event_type === "facility_dispatch") {
          facilityHandedOver = true;
          facilityHandedOverAt = op.created_at;
        } else if (op.event_type === "driver_collection_confirmed") {
          facilityCollected = true;
          facilityCollectedAt = op.created_at;
        }
      }

      if (!facilityCollected && assignment.status === "accepted") {
        if (arrivedAtFacility) {
          effectiveAssignmentStatus = "arrived";
        } else if (inTransitToFacility) {
          effectiveAssignmentStatus = "en_route";
        }
      }
    }

    let customer: { name: string | null; phone: string | null } | null = null;
    if (
      operationallyRelevant(
        assignment.assignment_type,
        effectiveAssignmentStatus,
        order.current_status,
      ) &&
      order.current_status !== "picked_up"
    ) {
      const { data: owner, error: ownerError } = await this.supabase.admin
        .from("customers")
        .select("profile_id")
        .eq("id", order.customer_id)
        .maybeSingle();
      if (ownerError || !owner)
        throw new BadRequestException("Unable to load job contact");
      const { data: profile, error: profileError } = await this.supabase.admin
        .from("profiles")
        .select("full_name,phone")
        .eq("id", owner.profile_id)
        .maybeSingle();
      if (profileError || !profile)
        throw new BadRequestException("Unable to load job contact");
      customer = { name: profile.full_name, phone: profile.phone };
    }
    return {
      id: assignment.id,
      orderId: order.id,
      orderNumber: order.order_number,
      type: assignment.assignment_type,
      assignmentStatus: effectiveAssignmentStatus,
      orderStatus: order.current_status,
      assignedAt: assignment.assigned_at,
      acceptedAt: assignment.accepted_at,
      completedAt: assignment.completed_at,
      pickupScheduledAt: order.pickup_scheduled_at,
      pickupSlotLabel: order.pickup_slot_label,
      address: addressResult.data,
      facility: facilityResult.data,
      customer,
      items: itemsResult.data ?? [],
      facilityHandedOver,
      facilityCollected,
      facilityHandedOverAt,
      facilityCollectedAt,
    };
  }

  async handoffQr(profileId: string, assignmentId: string) {
    const driver = await this.requireActiveDriver(profileId);
    const driverId = driver.id;
    const { data: assignment, error } = await this.supabase.admin
      .from("driver_assignments")
      .select("id,order_id,assignment_type,status")
      .eq("id", assignmentId)
      .eq("driver_id", driverId)
      .maybeSingle();
    if (error || !assignment)
      throw new NotFoundException("Assignment not found");
    if (
      assignment.assignment_type !== "pickup" ||
      assignment.status !== "arrived"
    )
      throw new ConflictException("Pickup handoff is not available");
    const { data: order, error: orderError } = await this.supabase.admin
      .from("orders")
      .select("id,current_status,facility_id")
      .eq("id", assignment.order_id)
      .maybeSingle();
    if (
      orderError ||
      !order ||
      !order.facility_id ||
      !["picked_up", "in_transit_to_facility"].includes(order.current_status)
    )
      throw new ConflictException("Order is not ready for facility handoff");
    const { data: qr, error: qrError } = await this.supabase.admin
      .from("order_qr_codes")
      .select("secure_token,is_active")
      .eq("order_id", order.id)
      .maybeSingle();
    if (qrError || !qr?.is_active)
      throw new NotFoundException("Active order QR not found");
    return { orderId: order.id, payload: `BW1:${qr.secure_token}` };
  }

  async location(
    profileId: string,
    assignmentId: string,
    latitude: number,
    longitude: number,
    accuracyM?: number,
  ) {
    const { data: driver, error: driverError } = await this.supabase.admin
      .from("drivers")
      .select("id,is_active")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (driverError || !driver?.is_active || !assignmentId) {
      throw new NotFoundException("Driver profile not found");
    }

    const { data, error } = await this.supabase.admin.rpc(
      "publish_driver_trip_location_atomic",
      {
        p_assignment_id: assignmentId,
        p_driver_id: driver.id,
        p_latitude: latitude,
        p_longitude: longitude,
        p_accuracy_m: accuracyM ?? null,
      },
    );

    if (error?.code === "P0002")
      throw new NotFoundException("Assignment not found");
    if (error) throw new ConflictException(error.message);

    return {
      published: data?.published === true,
      assignmentId,
      driverId: driver.id,
    };
  }
}
