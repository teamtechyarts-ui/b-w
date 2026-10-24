import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';

function fixture(rpcResult: { data: any; error: any } = { data: { assignment: { id: 'job-1' } }, error: null }) {
  const driverQuery: any = {};
  driverQuery.select = jest.fn(() => driverQuery);
  driverQuery.eq = jest.fn(() => driverQuery);
  driverQuery.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'driver-1', is_active: true }, error: null });
  const rpc = jest.fn().mockResolvedValue(rpcResult);
  const service = new LogisticsService({admin: {from: jest.fn(() => driverQuery), rpc}} as any, {} as any);
  return {service, rpc};
}

describe('7C assignment decisions', () => {
  it('requires a nonempty rejection reason before touching the database', async () => {
    const {service, rpc} = fixture();
    await expect(service.respondToAssignment('driver-profile', 'job-1', false, '  ')).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the authenticated driver identity for accept and reject', async () => {
    const {service, rpc} = fixture();
    await service.respondToAssignment('driver-profile', 'job-1', true);
    await service.respondToAssignment('driver-profile', 'job-1', false, '  Route blocked  ');
    expect(rpc).toHaveBeenNthCalledWith(1, 'transition_driver_assignment_atomic', {
      p_assignment_id: 'job-1', p_driver_id: 'driver-1', p_action: 'accept', p_rejection_reason: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'transition_driver_assignment_atomic', {
      p_assignment_id: 'job-1', p_driver_id: 'driver-1', p_action: 'reject', p_rejection_reason: 'Route blocked',
    });
  });

  it('rejects wrong-driver and stale or duplicate decisions', async () => {
    await expect(fixture({data: null, error: {code: 'P0002'}}).service.respondToAssignment('driver-profile', 'job-1', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(fixture({data: null, error: {code: '23514', message: 'Assignment can no longer be responded to'}}).service.respondToAssignment('driver-profile', 'job-1', true)).rejects.toBeInstanceOf(ConflictException);
  });

  it('passes the caller profile into the atomic Admin-only reassignment function', async () => {
    const {service, rpc} = fixture();
    await service.reassignDriver('admin-profile', 'job-1', 'driver-2');
    expect(rpc).toHaveBeenCalledWith('reassign_driver_assignment_atomic', {
      p_assignment_id: 'job-1', p_admin_profile_id: 'admin-profile', p_new_driver_id: 'driver-2',
    });
    await expect(fixture({data: null, error: {code: '42501'}}).service.reassignDriver('driver-profile', 'job-1', 'driver-2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects arrive transition for unaccepted or invalid assignment state', async () => {
    const driverQuery: any = {};
    driverQuery.select = jest.fn(() => driverQuery);
    driverQuery.eq = jest.fn(() => driverQuery);
    driverQuery.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'driver-1', is_active: true }, error: null });

    const assignmentQuery: any = {};
    assignmentQuery.select = jest.fn(() => assignmentQuery);
    assignmentQuery.eq = jest.fn(() => assignmentQuery);
    assignmentQuery.maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'job-1', order_id: 'order-1', assignment_type: 'delivery', status: 'assigned' },
      error: null,
    });

    const service = new LogisticsService({
      admin: {
        from: jest.fn((table: string) => (table === 'drivers' ? driverQuery : assignmentQuery)),
        rpc: jest.fn(),
      },
    } as any, {} as any);

    await expect(service.arrive('driver-profile', 'job-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('transitions accepted delivery with collection confirmed through arrival successfully', async () => {
    const driverQuery: any = {};
    driverQuery.select = jest.fn(() => driverQuery);
    driverQuery.eq = jest.fn(() => driverQuery);
    driverQuery.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'driver-1', is_active: true }, error: null });

    const assignmentQuery: any = {};
    assignmentQuery.select = jest.fn(() => assignmentQuery);
    assignmentQuery.eq = jest.fn(() => assignmentQuery);
    assignmentQuery.maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'job-1', order_id: 'order-1', assignment_type: 'delivery', status: 'accepted' },
      error: null,
    });

    const navQuery: any = {};
    navQuery.select = jest.fn(() => navQuery);
    navQuery.eq = jest.fn(() => navQuery);
    navQuery.limit = jest.fn().mockResolvedValue({
      data: [{ id: 'nav-collection-1', event_type: 'driver_collection_confirmed' }],
      error: null,
    });

    const rpc = jest.fn().mockResolvedValue({
      data: { orderId: 'order-1', assignmentStatus: 'arrived', orderStatus: 'delivery_otp_pending' },
      error: null,
    });

    const service = new LogisticsService({
      admin: {
        from: jest.fn((table: string) => {
          if (table === 'drivers') return driverQuery;
          if (table === 'driver_navigation_events') return navQuery;
          return assignmentQuery;
        }),
        rpc,
      },
    } as any, {} as any);

    const result = await service.arrive('driver-profile', 'job-1');
    expect(result).toMatchObject({
      assignmentId: 'job-1',
      orderId: 'order-1',
      assignmentStatus: 'arrived',
      orderStatus: 'delivery_otp_pending',
    });
    expect(rpc).toHaveBeenCalledWith('transition_driver_assignment_atomic', expect.objectContaining({
      p_assignment_id: 'job-1',
      p_action: 'start_navigation',
    }));
    expect(rpc).toHaveBeenCalledWith('transition_driver_assignment_atomic', expect.objectContaining({
      p_assignment_id: 'job-1',
      p_action: 'arrive',
    }));
  });

  it('correctly transitions, records navigation event, and broadcasts when pickup driver in in_transit_to_facility arrives at facility', async () => {
    const driverQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'driver-1', is_active: true, profile_id: 'driver-profile', profiles: { full_name: 'Fast Driver' } },
        error: null,
      }),
    };

    const assignmentQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'job-p1', order_id: 'order-p1', assignment_type: 'pickup', status: 'arrived' },
        error: null,
      }),
    };

    const orderQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'order-p1', current_status: 'in_transit_to_facility', facility_id: 'facility-p1', order_number: 'BW-200' },
        error: null,
      }),
    };

    const navInsert = jest.fn().mockResolvedValue({ error: null });
    const navQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      insert: navInsert,
    };

    const staffQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      then: jest.fn((resolve: any) => resolve({ data: [{ profile_id: 'staff-profile-1' }], error: null })),
    };

    const broadcastEvent = jest.fn().mockResolvedValue({ ok: true });
    const createAndBroadcastNotification = jest.fn().mockResolvedValue({ id: 'notif-1' });

    const service = new LogisticsService({
      admin: {
        from: jest.fn((table: string) => {
          if (table === 'drivers') return driverQuery;
          if (table === 'driver_assignments') return assignmentQuery;
          if (table === 'orders') return orderQuery;
          if (table === 'driver_navigation_events') return navQuery;
          if (table === 'facility_employees') return staffQuery;
          return assignmentQuery;
        }),
      },
      broadcastEvent,
      createAndBroadcastNotification,
    } as any, {} as any);

    const result = await service.arrive('driver-profile', 'job-p1');

    expect(result).toMatchObject({
      assignmentId: 'job-p1',
      orderId: 'order-p1',
      assignmentStatus: 'arrived',
      orderStatus: 'in_transit_to_facility',
      facilityArrival: true,
    });

    // Verify database navigation event was inserted
    expect(navInsert).toHaveBeenCalledWith(expect.objectContaining({
      driver_id: 'driver-1',
      order_id: 'order-p1',
      event_type: 'arrived_at_facility',
    }));

    // Verify DRIVER_ARRIVED_AT_FACILITY broadcast was dispatched to facility:all and facility:facility-p1
    expect(broadcastEvent).toHaveBeenCalledWith(
      'facility:all',
      'DRIVER_ARRIVED_AT_FACILITY',
      expect.objectContaining({
        eventType: 'DRIVER_ARRIVED_AT_FACILITY',
        orderId: 'order-p1',
        orderNumber: 'BW-200',
        facilityId: 'facility-p1',
        driverArrivedAtFacility: true,
      }),
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      'facility:facility-p1',
      'DRIVER_ARRIVED_AT_FACILITY',
      expect.objectContaining({
        orderId: 'order-p1',
        facilityId: 'facility-p1',
      }),
    );

    // Verify facility staff notification was created and dispatched
    expect(createAndBroadcastNotification).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'staff-profile-1',
      orderId: 'order-p1',
      notificationType: 'driver_arrived_at_facility',
      title: 'Driver Arrived at Facility',
    }));
  });
});
