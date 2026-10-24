import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { FacilityService } from "./facility.service";

function readable(result: unknown) {
  const chain: any = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn().mockResolvedValue({
    data: result,
    error: null,
  });
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: result, error: null }).then(resolve);
  return chain;
}

function serviceWithLatestOperation(
  orderStatus: string,
  operation: Record<string, unknown>,
  machine?: Record<string, unknown>,
  role = "manager",
  logistics?: { assignBestDriver: jest.Mock },
) {
  const insert = jest.fn();
  const update = jest.fn();
  const rpc = jest.fn();
  const from = jest.fn((table: string) => {
    if (table === "facility_employees") {
      return readable({
        id: "employee-1",
        facility_id: "facility-1",
        profile_id: "profile-1",
        employee_role: role,
        is_active: true,
      });
    }
    if (table === "orders") {
      return readable({
        id: "order-1",
        facility_id: "facility-1",
        current_status: orderStatus,
      });
    }
    if (table === "facilities")
      return readable({
        id: "facility-1",
        name: "Local Facility",
        is_active: true,
      });
    if (table === "facility_order_operations") {
      const chain = readable(operation);
      chain.insert = insert;
      chain.update = update;
      return chain;
    }
    if (table === "facility_machines") {
      return readable(machine ?? null);
    }
    if (table === "facility_packing_policy_orders") {
      return readable(null);
    }
    if (table === "facility_packings" || table === "facility_qc_decisions") {
      return readable([]);
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    service: new FacilityService(
      {
        admin: { from, rpc },
      } as any,
      logistics as any,
    ),
    insert,
    update,
    rpc,
  };
}

function serviceForReceipt() {
  const rpc = jest.fn();
  const from = jest.fn((table: string) => {
    if (table === "facility_employees") {
      return readable({
        id: "employee-1",
        facility_id: "facility-1",
        profile_id: "profile-1",
        is_active: true,
      });
    }
    if (table === "order_qr_codes") {
      return readable({
        id: "qr-1",
        order_id: "order-1",
        is_active: true,
        secure_token: "11111111-1111-4111-8111-111111111111",
      });
    }
    if (table === "orders") {
      return readable({
        id: "order-1",
        order_number: "BW-20260921-ABC12345",
        facility_id: "facility-1",
        current_status: "in_transit_to_facility",
      });
    }
    if (table === "order_items") {
      return readable([{ item_name: "Shirt", quantity: 2, weight_kg: 1.2 }]);
    }
    if (table === "facilities")
      return readable({
        id: "facility-1",
        name: "Local Facility",
        is_active: true,
      });
    if (table === "driver_navigation_events") {
      return readable([{ id: "nav-1", event_type: "arrived_at_facility" }]);
    }
    throw new Error(`Unexpected direct write to ${table}`);
  });

  return {
    service: new FacilityService({
      admin: { from, rpc },
    } as any),
    from,
    rpc,
  };
}

describe("FacilityService sequence", () => {
  it("requires an active facility employee even when the profile has an admin role", async () => {
    const rpc = jest.fn();
    const from = jest.fn((table: string) => {
      if (table === "facility_employees") {
        return readable(null);
      }

      if (table === "profile_roles") {
        return readable([
          {
            roles: {
              code: "admin",
            },
          },
        ]);
      }

      throw new Error(`Unexpected table ${table}`);
    });
    const service = new FacilityService({
      admin: { from, rpc },
    } as any);

    await expect(
      service.startProcessing("profile-1", "order-1", "washing"),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(from).not.toHaveBeenCalledWith("profile_roles");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records QR receipt, facility operation, and pickup completion through one atomic RPC", async () => {
    const fixture = serviceForReceipt();
    const token = "11111111-1111-4111-8111-111111111111";

    fixture.rpc.mockResolvedValue({
      data: {
        orderId: "order-1",
        operationId: "receipt-1",
        facilityStatus: "received",
        orderStatus: "received_at_facility",
        pickupAssignmentStatus: "completed",
        received: true,
      },
      error: null,
    });

    await expect(
      fixture.service.receiveByQr("profile-1", `BW1:${token}`, 17.4, 78.5),
    ).resolves.toEqual({
      orderId: "order-1",
      operationId: "receipt-1",
      facilityStatus: "received",
      orderStatus: "received_at_facility",
      pickupAssignmentStatus: "completed",
      received: true,
    });

    expect(fixture.rpc).toHaveBeenCalledWith("receive_facility_order_atomic", {
      p_secure_token: token,
      p_scanner_profile_id: "profile-1",
      p_latitude: 17.4,
      p_longitude: 78.5,
    });
    expect(fixture.from).toHaveBeenCalledTimes(5);
  });

  it("previews and receives an assigned order by its visible order ID", async () => {
    const fixture = serviceForReceipt();
    fixture.rpc.mockResolvedValue({
      data: {
        orderId: "order-1",
        operationId: "receipt-1",
        facilityStatus: "received",
        orderStatus: "received_at_facility",
        pickupAssignmentStatus: "completed",
        received: true,
      },
      error: null,
    });

    await expect(
      fixture.service.previewReceiptByOrderNumber(
        "profile-1",
        "bw-20260921-abc12345",
      ),
    ).resolves.toMatchObject({
      orderId: "order-1",
      orderNumber: "BW-20260921-ABC12345",
      items: [{ item_name: "Shirt", quantity: 2, weight_kg: 1.2 }],
    });
    await expect(
      fixture.service.receiveByOrderNumber("profile-1", "BW-20260921-ABC12345"),
    ).resolves.toMatchObject({
      orderId: "order-1",
      received: true,
    });
    expect(fixture.rpc).toHaveBeenCalledWith(
      "receive_facility_order_atomic",
      expect.objectContaining({
        p_secure_token: "11111111-1111-4111-8111-111111111111",
        p_scanner_profile_id: "profile-1",
      }),
    );
  });

  it("rejects drying before washing", async () => {
    const fixture = serviceWithLatestOperation("verification", {
      id: "operation-1",
      current_status: "verification",
      completed_at: new Date().toISOString(),
    });

    await expect(
      fixture.service.startProcessing("profile-1", "order-1", "drying"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("starts a processing stage through one atomic RPC", async () => {
    const fixture = serviceWithLatestOperation("verification", {
      id: "verification-1",
      current_status: "verification",
      operation_type: "verification",
      completed_at: new Date().toISOString(),
    });

    fixture.rpc.mockResolvedValue({
      data: {
        id: "washing-1",
        order_id: "order-1",
        current_status: "washing",
        operation_type: "washing",
        completed_at: null,
        operationId: "washing-1",
        previousFacilityStatus: "verification",
        facilityStatus: "washing",
        orderStatus: "processing",
      },
      error: null,
    });

    await expect(
      fixture.service.startProcessing("profile-1", "order-1", "washing"),
    ).resolves.toMatchObject({
      id: "washing-1",
      operationId: "washing-1",
      previousFacilityStatus: "verification",
      facilityStatus: "washing",
      orderStatus: "processing",
      completed_at: null,
    });

    expect(fixture.rpc).toHaveBeenCalledWith(
      "start_facility_processing_atomic",
      {
        p_order_id: "order-1",
        p_performed_by: "profile-1",
        p_process_type: "washing",
        p_machine_id: null,
      },
    );
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("rejects a processing machine assigned to another facility", async () => {
    const fixture = serviceWithLatestOperation(
      "verification",
      {
        id: "verification-1",
        current_status: "verification",
        operation_type: "verification",
        completed_at: new Date().toISOString(),
      },
      {
        id: "machine-1",
        facility_id: "facility-2",
        status: "active",
      },
    );

    await expect(
      fixture.service.startProcessing(
        "profile-1",
        "order-1",
        "washing",
        "machine-1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("rejects a processing machine that is not available", async () => {
    const fixture = serviceWithLatestOperation(
      "verification",
      {
        id: "verification-1",
        current_status: "verification",
        operation_type: "verification",
        completed_at: new Date().toISOString(),
      },
      {
        id: "machine-1",
        facility_id: "facility-1",
        status: "maintenance",
      },
    );

    await expect(
      fixture.service.startProcessing(
        "profile-1",
        "order-1",
        "washing",
        "machine-1",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing operation", "P0002", NotFoundException],
    ["revoked facility access", "42501", ForbiddenException],
    ["invalid sequence", "23514", ConflictException],
    ["concurrent change", "40001", ConflictException],
  ])("maps an atomic processing %s error", async (_label, code, expected) => {
    const fixture = serviceWithLatestOperation("verification", {
      id: "verification-1",
      current_status: "verification",
      operation_type: "verification",
      completed_at: new Date().toISOString(),
    });

    fixture.rpc.mockResolvedValue({
      data: null,
      error: {
        code,
        message: _label,
      },
    });

    await expect(
      fixture.service.startProcessing("profile-1", "order-1", "washing"),
    ).rejects.toBeInstanceOf(expected);
  });

  it("can retry a processing start after an atomic RPC failure", async () => {
    const fixture = serviceWithLatestOperation("verification", {
      id: "verification-1",
      current_status: "verification",
      operation_type: "verification",
      completed_at: new Date().toISOString(),
    });

    fixture.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "XX000",
          message: "temporary database failure",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "washing-1",
          operationId: "washing-1",
          previousFacilityStatus: "verification",
          facilityStatus: "washing",
          orderStatus: "processing",
        },
        error: null,
      });

    await expect(
      fixture.service.startProcessing("profile-1", "order-1", "washing"),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      fixture.service.startProcessing("profile-1", "order-1", "washing"),
    ).resolves.toMatchObject({
      operationId: "washing-1",
      facilityStatus: "washing",
    });

    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("completes the current processing stage through one atomic RPC", async () => {
    const fixture = serviceWithLatestOperation("processing", {
      id: "washing-1",
      order_id: "order-1",
      current_status: "washing",
      operation_type: "washing",
      completed_at: null,
    });

    fixture.rpc.mockResolvedValue({
      data: {
        id: "washing-1",
        order_id: "order-1",
        current_status: "washing",
        operation_type: "washing",
        completed_at: "2026-09-10T12:00:00.000Z",
        processingCompleted: true,
      },
      error: null,
    });

    await expect(
      fixture.service.completeProcessing("profile-1", "washing-1"),
    ).resolves.toMatchObject({
      id: "washing-1",
      current_status: "washing",
      completed_at: "2026-09-10T12:00:00.000Z",
      processingCompleted: true,
    });

    expect(fixture.rpc).toHaveBeenCalledWith(
      "complete_facility_processing_atomic",
      {
        p_operation_id: "washing-1",
        p_performed_by: "profile-1",
      },
    );
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("can retry processing completion after an atomic RPC failure", async () => {
    const fixture = serviceWithLatestOperation("processing", {
      id: "washing-1",
      order_id: "order-1",
      current_status: "washing",
      operation_type: "washing",
      completed_at: null,
    });

    fixture.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "XX000",
          message: "temporary database failure",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "washing-1",
          completed_at: "2026-09-10T12:00:00.000Z",
          processingCompleted: true,
        },
        error: null,
      });

    await expect(
      fixture.service.completeProcessing("profile-1", "washing-1"),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      fixture.service.completeProcessing("profile-1", "washing-1"),
    ).resolves.toMatchObject({
      id: "washing-1",
      processingCompleted: true,
    });

    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("rejects quality control before completed packaging", async () => {
    const fixture = serviceWithLatestOperation("processing", {
      id: "operation-1",
      current_status: "washing",
      operation_type: "washing",
      completed_at: new Date().toISOString(),
    });

    await expect(
      fixture.service.qualityCheck("profile-1", "order-1", true),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("records verification and inspection through one atomic RPC", async () => {
    const fixture = serviceWithLatestOperation("received_at_facility", {
      id: "receipt-1",
      current_status: "received",
      operation_type: "facility_workflow",
      completed_at: new Date().toISOString(),
    });

    fixture.rpc.mockResolvedValue({
      data: {
        operationId: "verification-1",
      },
      error: null,
    });

    await expect(
      fixture.service.verifyOrder("profile-1", "order-1", {
        itemCount: 4,
        weightKg: 2.5,
        notes: "verified",
      }),
    ).resolves.toEqual({
      orderId: "order-1",
      operationId: "verification-1",
      verified: true,
      facilityStatus: "verification",
      orderStatus: "verification",
    });

    expect(fixture.rpc).toHaveBeenCalledWith(
      "record_facility_verification_atomic",
      {
        p_order_id: "order-1",
        p_performed_by: "profile-1",
        p_item_count: 4,
        p_weight_kg: 2.5,
        p_notes: "verified",
      },
    );
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("can retry verification after an atomic RPC failure", async () => {
    const fixture = serviceWithLatestOperation("received_at_facility", {
      id: "receipt-1",
      current_status: "received",
      operation_type: "facility_workflow",
      completed_at: new Date().toISOString(),
    });

    fixture.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: "inspection insert failed",
        },
      })
      .mockResolvedValueOnce({
        data: {
          operationId: "verification-1",
        },
        error: null,
      });

    await expect(
      fixture.service.verifyOrder("profile-1", "order-1", {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      fixture.service.verifyOrder("profile-1", "order-1", {}),
    ).resolves.toMatchObject({
      operationId: "verification-1",
      verified: true,
    });

    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("commits an approved quality verdict through one atomic RPC", async () => {
    const logistics = {
      assignBestDriver: jest.fn().mockResolvedValue({
        assignment: { id: "delivery-1" },
      }),
    };
    const fixture = serviceWithLatestOperation(
      "processing",
      {
        id: "packaging-1",
        current_status: "packaging",
        operation_type: "packaging",
        completed_at: new Date().toISOString(),
      },
      undefined,
      "facility_employee",
      logistics,
    );

    fixture.rpc.mockResolvedValue({
      data: {
        operationId: "quality-1",
        facilityStatus: "ready_for_delivery",
        orderStatus: "ready_for_delivery",
        rewashRequired: false,
        cycleNumber: 0,
      },
      error: null,
    });

    await expect(
      fixture.service.qualityCheck("profile-1", "order-1", true, "approved"),
    ).resolves.toEqual({
      orderId: "order-1",
      operationId: "quality-1",
      approved: true,
      rewashRequired: false,
      cycleNumber: 0,
      facilityStatus: "ready_for_delivery",
      orderStatus: "ready_for_delivery",
    });

    expect(fixture.rpc).toHaveBeenCalledWith(
      "record_facility_qc_decision_atomic",
      {
        p_order_id: "order-1",
        p_performed_by: "profile-1",
        p_approved: true,
        p_defect_code: null,
        p_reason: "approved",
        p_affected_item_ids: [],
      },
    );
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(logistics.assignBestDriver).not.toHaveBeenCalled();
  });

  it("allows Staff QC and requires a defect and reason for failed QC", async () => {
    const packaged = {
      id: "packaging-1",
      current_status: "packaging",
      operation_type: "packaging",
      completed_at: new Date().toISOString(),
    };
    const staff = serviceWithLatestOperation(
      "processing",
      packaged,
      undefined,
      "facility_employee",
    );
    staff.rpc.mockResolvedValueOnce({
      data: {
        operationId: "qc-staff",
        orderStatus: "ready_for_delivery",
        facilityStatus: "ready_for_delivery",
        rewashRequired: false,
        cycleNumber: 0,
      },
      error: null,
    });
    await expect(
      staff.service.qualityCheck("profile-1", "order-1", true),
    ).resolves.toMatchObject({
      approved: true,
      orderStatus: "ready_for_delivery",
    });
    const manager = serviceWithLatestOperation("processing", packaged);
    await expect(
      manager.service.qualityCheck("profile-1", "order-1", false, "bad"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.rpc).not.toHaveBeenCalled();
    manager.rpc.mockResolvedValue({
      data: {
        operationId: "qc-1",
        orderStatus: "rework_required",
        facilityStatus: "rework_required",
        rewashRequired: true,
        cycleNumber: 0,
      },
      error: null,
    });
    await expect(
      manager.service.qualityCheck(
        "profile-1",
        "order-1",
        false,
        "Stain remains",
        "stain",
        ["item-1"],
      ),
    ).resolves.toMatchObject({
      rewashRequired: true,
      orderStatus: "rework_required",
    });
    expect(manager.rpc).toHaveBeenCalledWith(
      "record_facility_qc_decision_atomic",
      {
        p_order_id: "order-1",
        p_performed_by: "profile-1",
        p_approved: false,
        p_defect_code: "stain",
        p_reason: "Stain remains",
        p_affected_item_ids: ["item-1"],
      },
    );
  });

  it("loads processingHistory without querying rewash_cycle on facility_order_operations", async () => {
    let operationSelectFields = "";
    const from = jest.fn((table: string) => {
      const chain: any = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        chain[method] = jest.fn((...args: any[]) => {
          if (table === "facility_order_operations" && method === "select") {
            operationSelectFields = args[0] || "";
          }
          return chain;
        });
      }
      chain.maybeSingle = jest.fn().mockResolvedValue({
        data:
          table === "facility_employees"
            ? { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true }
            : table === "facilities"
              ? { id: "facility-1", name: "Local Facility", is_active: true }
              : table === "orders"
                ? { id: "order-1", facility_id: "facility-1", current_status: "processing" }
                : null,
        error: null,
      });
      chain.then = (resolve: (value: unknown) => unknown) => {
        let data: any = [];
        if (table === "facility_employees") {
          data = { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true };
        } else if (table === "facilities") {
          data = { id: "facility-1", name: "Local Facility", is_active: true };
        } else if (table === "orders") {
          data = { id: "order-1", facility_id: "facility-1", current_status: "processing" };
        } else if (table === "facility_order_operations") {
          data = [
            {
              id: "op-1",
              operation_type: "washing",
              current_status: "washing",
              started_at: "2026-10-10T10:00:00Z",
              completed_at: "2026-10-10T10:30:00Z",
              performed_by: "staff-1",
              notes: null,
            },
            {
              id: "op-2",
              operation_type: "drying",
              current_status: "drying",
              started_at: "2026-10-10T10:35:00Z",
              completed_at: null,
              performed_by: "staff-1",
              notes: null,
            },
          ];
        } else if (table === "facility_intake_discrepancies") {
          return Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
        } else if (table === "facility_qc_decisions") {
          data = [];
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    });

    const service = new FacilityService({ admin: { from, rpc: jest.fn() } } as any);
    const history = await service.processingHistory("profile-1", "order-1");

    expect(operationSelectFields).not.toContain("rewash_cycle");
    expect(history.orderId).toBe("order-1");
    expect(history.rewashCycle).toBe(0);
    expect(history.stages).toHaveLength(2);
    expect(history.stages[0].rewash_cycle).toBe(0);
    expect(history.stages[1].rewash_cycle).toBe(0);
  });

  it("dynamically increments rewash_cycle for stages following QC rejection", async () => {
    const from = jest.fn((table: string) => {
      const chain: any = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        chain[method] = jest.fn(() => chain);
      }
      chain.maybeSingle = jest.fn().mockResolvedValue({
        data:
          table === "facility_employees"
            ? { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true }
            : table === "facilities"
              ? { id: "facility-1", name: "Local Facility", is_active: true }
              : table === "orders"
                ? { id: "order-1", facility_id: "facility-1", current_status: "processing" }
                : null,
        error: null,
      });
      chain.then = (resolve: (value: unknown) => unknown) => {
        let data: any = [];
        if (table === "facility_employees") {
          data = { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true };
        } else if (table === "facilities") {
          data = { id: "facility-1", name: "Local Facility", is_active: true };
        } else if (table === "orders") {
          data = { id: "order-1", facility_id: "facility-1", current_status: "processing" };
        } else if (table === "facility_order_operations") {
          data = [
            {
              id: "op-1",
              operation_type: "washing",
              current_status: "washing",
              started_at: "2026-10-10T10:00:00Z",
              completed_at: "2026-10-10T10:30:00Z",
              performed_by: "staff-1",
              notes: null,
            },
            {
              id: "op-2",
              operation_type: "washing",
              current_status: "washing",
              started_at: "2026-10-10T12:00:00Z",
              completed_at: null,
              performed_by: "staff-1",
              notes: null,
            },
          ];
        } else if (table === "facility_intake_discrepancies") {
          return Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
        } else if (table === "facility_qc_decisions") {
          data = [
            {
              id: "qc-1",
              operation_id: "op-qc",
              cycle_number: 0,
              approved: false,
              rewash_required: true,
              defect_code: "stain",
              reason: "stain remaining",
              affected_item_ids: [],
              decided_by: "qc-staff",
              created_at: "2026-10-10T11:00:00Z",
            },
          ];
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    });

    const service = new FacilityService({ admin: { from, rpc: jest.fn() } } as any);
    const history = await service.processingHistory("profile-1", "order-1");

    expect(history.rewashCycle).toBe(1);
    expect(history.stages[0].rewash_cycle).toBe(0); // Cycle 1 (initial) before QC fail
    expect(history.stages[1].rewash_cycle).toBe(1); // Cycle 2 (rewash) after QC fail
  });

  it("returns packingReady true when packing policy is not required", async () => {
    const from = jest.fn((table: string) => {
      const chain: any = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        chain[method] = jest.fn(() => chain);
      }
      chain.maybeSingle = jest.fn().mockResolvedValue({
        data:
          table === "facility_employees"
            ? { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true }
            : table === "facilities"
              ? { id: "facility-1", name: "Local Facility", is_active: true }
              : table === "orders"
                ? { id: "order-1", facility_id: "facility-1", current_status: "processing" }
                : null,
        error: null,
      });
      chain.then = (resolve: (value: unknown) => unknown) => {
        let data: any = [];
        if (table === "facility_employees") {
          data = { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true };
        } else if (table === "facilities") {
          data = { id: "facility-1", name: "Local Facility", is_active: true };
        } else if (table === "orders") {
          data = { id: "order-1", facility_id: "facility-1", current_status: "processing" };
        } else if (table === "facility_order_operations") {
          data = [
            {
              id: "op-1",
              operation_type: "packaging",
              current_status: "packaging",
              started_at: "2026-10-10T10:00:00Z",
              completed_at: "2026-10-10T10:30:00Z",
              performed_by: "staff-1",
              notes: null,
            },
          ];
        } else if (table === "facility_intake_discrepancies") {
          return Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
        } else if (table === "facility_qc_decisions" || table === "facility_packings") {
          data = [];
        } else if (table === "facility_packing_policy_orders") {
          data = null;
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    });

    const service = new FacilityService({ admin: { from, rpc: jest.fn() } } as any);
    const history = await service.processingHistory("profile-1", "order-1");

    expect(history.canQualityCheck).toBe(true);
    expect(history.packingRequired).toBe(false);
    expect(history.packingReady).toBe(true);
  });

  it("blocks quality check approval when packing policy is active and final packing is missing", async () => {
    const packaged = {
      id: "op-packaging",
      current_status: "packaging",
      operation_type: "packaging",
      completed_at: new Date().toISOString(),
    };
    const rpc = jest.fn();
    const from = jest.fn((table: string) => {
      const chain: any = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        chain[method] = jest.fn(() => chain);
      }
      chain.maybeSingle = jest.fn().mockResolvedValue({
        data:
          table === "facility_employees"
            ? { id: "emp-1", facility_id: "facility-1", profile_id: "profile-1", employee_role: "manager", is_active: true }
            : table === "facilities"
              ? { id: "facility-1", name: "Local Facility", is_active: true }
              : table === "orders"
                ? { id: "order-1", facility_id: "facility-1", current_status: "processing" }
                : table === "facility_order_operations"
                  ? packaged
                  : table === "facility_packing_policy_orders"
                    ? { order_id: "order-1" }
                    : null,
        error: null,
      });
      chain.then = (resolve: (value: unknown) => unknown) => {
        let data: any = [];
        if (table === "facility_packings" || table === "facility_qc_decisions") {
          data = [];
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    });

    const service = new FacilityService({ admin: { from, rpc } } as any);
    await expect(
      service.qualityCheck("profile-1", "order-1", true, "All good"),
    ).rejects.toThrow("Confirm current-cycle final packing before quality check approval");
  });
});

