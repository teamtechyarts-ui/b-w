import { ConflictException, NotFoundException } from '@nestjs/common';
import { DriversService } from './drivers.service';

const own = {id: 'assignment-own', order_id: 'order-own', driver_id: 'driver-own',
  assignment_type: 'pickup', status: 'assigned', assigned_at: new Date().toISOString(),
  accepted_at: null, completed_at: null};

function fixture(data: Record<string, unknown[]>, rpcHandler?: (name: string, args: any) => Promise<any>) {
  const filters: Array<{table: string; method: string; args: unknown[]}> = [];
  const counters: Record<string, number> = {};
  const from = jest.fn((table: string) => {
    const index = counters[table] ?? 0;
    counters[table] = index + 1;
    const value = data[table]?.[index] ?? null;
    const query: any = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit']) {
      query[method] = (...args: unknown[]) => {
        filters.push({table, method, args});
        return query;
      };
    }
    query.maybeSingle = () => Promise.resolve({data: value, error: null});
    query.then = (resolve: any) => Promise.resolve({data: value, error: null}).then(resolve);
    return query;
  });
  const rpc = jest.fn((name: string, args: any) => {
    if (rpcHandler) return rpcHandler(name, args);
    return Promise.resolve({data: null, error: null});
  });
  return {service: new DriversService({admin: {from, rpc}} as any), from, rpc, filters};
}

describe('Driver dashboard assignment isolation', () => {
  it('resolves an exact order number only for the owning active Driver', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      orders: [{id: 'order-own', order_number: 'BW-20260921-ABC12345', current_status: 'pickup_assigned'}],
      driver_assignments: [own],
    });
    await expect(f.service.lookupOrder('profile-own', 'bw-20260921-abc12345')).resolves.toMatchObject({
      assignmentId: 'assignment-own', orderNumber: 'BW-20260921-ABC12345', assignmentStatus: 'assigned',
    });
    expect(f.filters).toContainEqual({table: 'driver_assignments', method: 'eq', args: ['driver_id', 'driver-own']});
  });

  it('resolves a stable QR payload only for the owning active Driver', async () => {
    const token = '00000000-0000-4000-8000-000000000001';
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      order_qr_codes: [{order_id: 'order-own', is_active: true}],
      orders: [{id: 'order-own', order_number: 'BW-20260921-ABC12345', current_status: 'pickup_assigned'}],
      driver_assignments: [own],
    });
    await expect(f.service.lookupOrder('profile-own', `BW1:${token}`)).resolves.toMatchObject({assignmentId: 'assignment-own'});
  });

  it('does not expose an unassigned order or another Driver’s assignment', async () => {
    const unassigned = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      orders: [{id: 'order-own', order_number: 'BW-20260921-ABC12345', current_status: 'confirmed'}],
      driver_assignments: [null],
    });
    await expect(unassigned.service.lookupOrder('profile-own', 'BW-20260921-ABC12345')).rejects.toBeInstanceOf(NotFoundException);
    const wrong = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      orders: [{id: 'order-own', order_number: 'BW-20260921-ABC12345', current_status: 'pickup_assigned'}],
      driver_assignments: [null],
    });
    await expect(wrong.service.lookupOrder('profile-own', 'BW-20260921-ABC12345')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects cancelled and lifecycle-ineligible assignments', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      orders: [{id: 'order-own', order_number: 'BW-20260921-ABC12345', current_status: 'cancelled'}],
      driver_assignments: [own],
    });
    await expect(f.service.lookupOrder('profile-own', 'BW-20260921-ABC12345')).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns only this Driver’s jobs and never includes customer contact in queues', async () => {
    const other = {...own, id: 'assignment-other', order_id: 'order-other', driver_id: 'driver-other'};
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [[own, other], [], []],
      orders: [[{id: 'order-own', current_status: 'pickup_assigned', pickup_address_id: null,
        delivery_address_id: null, facility_id: null, pickup_scheduled_at: null, pickup_slot_label: null}]],
    });
    const result = await f.service.dashboard('profile-own');
    expect(result.summary.pickups).toBe(1);
    expect(result.pickups[0].id).toBe('assignment-own');
    expect(result.pickups[0]).not.toHaveProperty('customer');
    expect(f.filters.filter(row => row.table === 'driver_assignments' && row.method === 'eq'))
      .toEqual(expect.arrayContaining([{table: 'driver_assignments', method: 'eq', args: ['driver_id', 'driver-own']}]));
    expect(f.filters.find(row => row.table === 'orders' && row.method === 'in')?.args[1]).toEqual(['order-own']);
  });

  it('separates today’s pickup and delivery queues with status counts', async () => {
    const delivery = {...own, id: 'assignment-delivery', order_id: 'order-delivery',
      assignment_type: 'delivery', status: 'accepted'};
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [[own, delivery], [], []],
      orders: [[
        {id: 'order-own', current_status: 'pickup_assigned', pickup_address_id: null, delivery_address_id: null, facility_id: null},
        {id: 'order-delivery', current_status: 'delivery_accepted', pickup_address_id: null, delivery_address_id: null, facility_id: null},
      ]],
    });
    const result = await f.service.dashboard('profile-own');
    expect(result.summary).toMatchObject({pickups: 1, deliveries: 1, pending: 1, inProgress: 1});
    expect(result.pickups.map(job => job.id)).toEqual(['assignment-own']);
    expect(result.deliveries.map(job => job.id)).toEqual(['assignment-delivery']);
  });

  it('rejects another Driver’s assignment before reading its order or contact', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [{...own, driver_id: 'driver-other'}],
    });
    await expect(f.service.assignment('profile-own', 'assignment-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.from).not.toHaveBeenCalledWith('orders');
    expect(f.filters).toContainEqual({table: 'driver_assignments', method: 'eq', args: ['driver_id', 'driver-own']});
  });

  it('omits customer contact after the assignment is completed', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [{...own, status: 'completed'}],
      orders: [{id: 'order-own', customer_id: 'customer-1', facility_id: null,
        pickup_address_id: null, delivery_address_id: null, current_status: 'delivered'}],
    });
    const result = await f.service.assignment('profile-own', own.id);
    expect(result.customer).toBeNull();
    expect(f.from).not.toHaveBeenCalledWith('profiles');
  });

  it('reveals customer contact only when this Driver has an active assignment', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [own],
      orders: [{id: 'order-own', customer_id: 'customer-1', facility_id: null,
        pickup_address_id: null, delivery_address_id: null, current_status: 'pickup_assigned'}],
      customers: [{profile_id: 'customer-profile'}],
      profiles: [{full_name: 'Fictional Customer', phone: '+16505550101'}],
    });
    const result = await f.service.assignment('profile-own', own.id);
    expect(result.customer).toEqual({name: 'Fictional Customer', phone: '+16505550101'});
    expect(f.filters).toContainEqual({table: 'customers', method: 'eq', args: ['id', 'customer-1']});
  });

  it('shows existing order items only after verifying the Driver owns the pickup assignment', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [{...own, status: 'arrived'}],
      orders: [{id: 'order-own', customer_id: 'customer-1', facility_id: null,
        pickup_address_id: null, delivery_address_id: null, current_status: 'pickup_otp_pending'}],
      order_items: [[{id: 'item-1', item_name: 'Shirts', quantity: 2, weight_kg: 1.5, customer_notes: null}]],
      customers: [{profile_id: 'customer-profile'}],
      profiles: [{full_name: 'Fictional Customer', phone: '+16505550101'}],
    });
    const result = await f.service.assignment('profile-own', own.id);
    expect(result.items).toEqual([{id: 'item-1', item_name: 'Shirts', quantity: 2, weight_kg: 1.5, customer_notes: null}]);
    expect(f.filters).toContainEqual({table: 'order_items', method: 'eq', args: ['order_id', 'order-own']});
  });

  it('keeps picked-up jobs available for the next step without exposing customer contact', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [{...own, status: 'arrived'}],
      orders: [{id: 'order-own', customer_id: 'customer-1', facility_id: null,
        pickup_address_id: null, delivery_address_id: null, current_status: 'picked_up'}],
    });
    const result = await f.service.assignment('profile-own', own.id);
    expect(result.orderStatus).toBe('picked_up');
    expect(result.customer).toBeNull();
    expect(f.from).not.toHaveBeenCalledWith('profiles');
  });

  it('hides contact when an old active assignment points to a delivered order', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [own],
      orders: [{id: 'order-own', customer_id: 'customer-1', facility_id: null,
        pickup_address_id: null, delivery_address_id: null, current_status: 'delivered'}],
    });
    const result = await f.service.assignment('profile-own', own.id);
    expect(result.customer).toBeNull();
    expect(f.from).not.toHaveBeenCalledWith('profiles');
  });

  it('requires an active Driver record before any assignment read', async () => {
    const f = fixture({drivers: [{id: 'driver-own', is_active: false}]});
    await expect(f.service.dashboard('profile-own')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.from).not.toHaveBeenCalledWith('driver_assignments');
  });

  it('shows an in-transit pickup on the Driver dashboard', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [[{...own, status: 'arrived'}], [], []],
      orders: [[{id: 'order-own', current_status: 'in_transit_to_facility', pickup_address_id: null,
        delivery_address_id: null, facility_id: null}]],
    });
    const result = await f.service.dashboard('profile-own');
    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0].orderStatus).toBe('in_transit_to_facility');
  });

  it('counts completed work but removes it from pickup and delivery queues', async () => {
    const completed = {...own, status: 'completed', completed_at: new Date().toISOString()};
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [[], [completed], [completed]],
      orders: [[{id: 'order-own', order_number: 'BW-COMPLETE', current_status: 'claim_period_active',
        pickup_address_id: null, delivery_address_id: null, facility_id: null}]],
    });
    const result = await f.service.dashboard('profile-own');
    expect(result.summary.completed).toBe(1);
    expect(result.summary.pickups).toBe(0);
    expect(result.pickups).toEqual([]);
    expect(result.deliveries).toEqual([]);
  });

  it('provides the active handoff code only to the owning Driver after pickup', async () => {
    const f = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [{...own, status: 'arrived'}],
      orders: [{id: 'order-own', current_status: 'in_transit_to_facility', facility_id: 'facility-own'}],
      order_qr_codes: [{secure_token: 'token-own', is_active: true}],
    });
    await expect(f.service.handoffQr('profile-own', own.id)).resolves.toEqual({orderId: 'order-own', payload: 'BW1:token-own'});
    expect(f.filters).toContainEqual({table: 'driver_assignments', method: 'eq', args: ['driver_id', 'driver-own']});
  });

  it('rejects another Driver or an ineligible order before exposing a handoff code', async () => {
    const wrong = fixture({drivers: [{id: 'driver-own', is_active: true}], driver_assignments: [null]});
    await expect(wrong.service.handoffQr('profile-own', 'assignment-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(wrong.from).not.toHaveBeenCalledWith('order_qr_codes');
    const cancelled = fixture({
      drivers: [{id: 'driver-own', is_active: true}],
      driver_assignments: [{...own, status: 'arrived'}],
      orders: [{id: 'order-own', current_status: 'cancelled', facility_id: 'facility-own'}],
    });
    await expect(cancelled.service.handoffQr('profile-own', own.id)).rejects.toBeInstanceOf(ConflictException);
    expect(cancelled.from).not.toHaveBeenCalledWith('order_qr_codes');
  });

  describe('claimJob availability dispatch', () => {
    it('successfully claims an available pickup job atomically', async () => {
      const f = fixture(
        { drivers: [{ id: 'driver-own', is_active: true, is_available: true }] },
        async (name, args) => {
          expect(name).toBe('claim_driver_job_atomic');
          expect(args).toEqual({
            p_order_id: 'order-1',
            p_driver_id: 'driver-own',
            p_job_type: 'pickup',
          });
          return {
            data: {
              assignment: { id: 'assignment-new', order_id: 'order-1', status: 'accepted' },
              orderStatus: 'pickup_accepted',
            },
            error: null,
          };
        },
      );
      const res = await f.service.claimJob('profile-own', 'order-1', 'pickup');
      expect(res).toEqual({
        success: true,
        assignment: { id: 'assignment-new', order_id: 'order-1', status: 'accepted' },
        orderStatus: 'pickup_accepted',
      });
    });

    it('successfully claims an available delivery job atomically', async () => {
      const f = fixture(
        { drivers: [{ id: 'driver-own', is_active: true, is_available: true }] },
        async (name, args) => {
          expect(name).toBe('claim_driver_job_atomic');
          expect(args).toEqual({
            p_order_id: 'order-2',
            p_driver_id: 'driver-own',
            p_job_type: 'delivery',
          });
          return {
            data: {
              assignment: { id: 'assignment-deliv', order_id: 'order-2', status: 'accepted' },
              orderStatus: 'delivery_accepted',
            },
            error: null,
          };
        },
      );
      const res = await f.service.claimJob('profile-own', 'order-2', 'delivery');
      expect(res.orderStatus).toBe('delivery_accepted');
    });

    it('rejects claim when driver is marked unavailable', async () => {
      const f = fixture({
        drivers: [{ id: 'driver-own', is_active: true, is_available: false }],
      });
      await expect(f.service.claimJob('profile-own', 'order-1', 'pickup')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(f.rpc).not.toHaveBeenCalled();
    });

    it('returns conflict error when job is already claimed by another driver (code 23505)', async () => {
      const f = fixture(
        { drivers: [{ id: 'driver-own', is_active: true, is_available: true }] },
        async () => ({
          data: null,
          error: { code: '23505', message: 'Job has already been claimed by another driver' },
        }),
      );
      await expect(f.service.claimJob('profile-own', 'order-1', 'pickup')).rejects.toThrow(
        'This job has already been claimed by another driver.',
      );
    });

    it('returns not found when order does not exist (code P0002)', async () => {
      const f = fixture(
        { drivers: [{ id: 'driver-own', is_active: true, is_available: true }] },
        async () => ({
          data: null,
          error: { code: 'P0002', message: 'Order not found' },
        }),
      );
      await expect(f.service.claimJob('profile-own', 'order-missing', 'pickup')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
