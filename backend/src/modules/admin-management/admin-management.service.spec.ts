import {BadRequestException, ConflictException, NotFoundException} from '@nestjs/common';
import {AdminManagementService} from './admin-management.service';

function fixture(rows: Record<string, {data?: any; error?: any}>) {
  const rpc = jest.fn();
  const from = jest.fn((table: string) => {
    const result = rows[table] ?? {data: null, error: null};
    const chain: any = {then: (resolve: any) => Promise.resolve(result).then(resolve)};
    for (const name of ['select', 'eq', 'or', 'in', 'order', 'limit', 'maybeSingle']) chain[name] = jest.fn(() => chain);
    return chain;
  });
  const service = new AdminManagementService({admin: {from, rpc}} as any);
  return {service, from, rpc};
}

describe('Admin management read-only contract', () => {
  it('searches profiles and limits results to customer records', async () => {
    const f = fixture({profiles: {data: [{id: 'profile-1'}]}, customers: {data: [{id: 'customer-1'}]}});
    expect(await f.service.customers('Example')).toEqual([{id: 'customer-1'}]);
    expect(f.from).toHaveBeenCalledWith('profiles');
    expect(f.from).toHaveBeenCalledWith('customers');
  });
  it('returns empty results without scanning customers when no profile matches', async () => {
    const f = fixture({profiles: {data: []}});
    expect(await f.service.customers('unknown')).toEqual([]);
    expect(f.from).not.toHaveBeenCalledWith('customers');
  });
  it('rejects missing customer and never returns another record', async () => {
    const f = fixture({customers: {data: null}});
    await expect(f.service.customer('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('aggregates existing order, payment/refund and claim history without writes', async () => {
    const f = fixture({orders: {data: {id: 'order-1'}}, payment_orders: {data: [{id: 'payment-1'}]}, customer_order_claims: {data: [{id: 'claim-1'}]}});
    expect(await f.service.order('order-1')).toEqual({order: {id: 'order-1'}, payments: [{id: 'payment-1'}], claims: [{id: 'claim-1'}]});
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('cancels only through the Admin atomic procedure and maps ineligible status', async () => {
    const f = fixture({});
    f.rpc.mockResolvedValueOnce({data: {orderStatus: 'cancelled'}, error: null})
      .mockResolvedValueOnce({data: null, error: {code: '23514', message: 'Ineligible'}});
    await expect(f.service.cancel('admin-1', 'order-1', 'Requested by support')).resolves.toEqual({orderStatus: 'cancelled'});
    expect(f.rpc).toHaveBeenCalledWith('cancel_order_by_admin_atomic', {
      p_order_id: 'order-1', p_admin_profile_id: 'admin-1', p_reason: 'Requested by support',
    });
    await expect(f.service.cancel('admin-1', 'order-1', 'Again')).rejects.toBeInstanceOf(ConflictException);
  });
  it('searches customers by order number matching an order', async () => {
    const f = fixture({
      orders: {data: [{customer_id: 'customer-1'}]},
      profiles: {data: []},
      customers: {data: [{id: 'customer-1'}]},
    });
    expect(await f.service.customers('BW-20261001-3F97A3B9')).toEqual([{id: 'customer-1'}]);
    expect(f.from).toHaveBeenCalledWith('orders');
    expect(f.from).toHaveBeenCalledWith('customers');
  });
  it('fetches order details by order number as well as uuid', async () => {
    const f = fixture({
      orders: {data: {id: 'order-1', order_number: 'BW-20261001-3F97A3B9', facility_id: 'facility-1', facilities: {id: 'facility-1', name: 'Central Facility', address: 'haythnagar'}}},
      payment_orders: {data: [{id: 'payment-1', status: 'confirmed', amount: 942.82}]},
      customer_order_claims: {data: []},
    });
    const result = await f.service.order('BW-20261001-3F97A3B9');
    expect(result.order.order_number).toBe('BW-20261001-3F97A3B9');
    expect(result.order.facilities).toEqual({id: 'facility-1', name: 'Central Facility', address: 'haythnagar'});
    expect(result.payments).toEqual([{id: 'payment-1', status: 'confirmed', amount: 942.82}]);
  });
  it('returns customer orders list', async () => {
    const f = fixture({
      customers: {data: {id: 'customer-1', profile_id: 'profile-1'}},
      orders: {data: [{id: 'order-1', order_number: 'BW-1', total_amount: 942.82}]},
    });
    expect(await f.service.orders('customer-1')).toEqual([{id: 'order-1', order_number: 'BW-1', total_amount: 942.82}]);
  });
  it('rejects overlong search', async () => {
    const f = fixture({});
    await expect(f.service.customers('x'.repeat(101))).rejects.toBeInstanceOf(BadRequestException);
  });
});
