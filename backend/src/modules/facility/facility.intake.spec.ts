import {ConflictException, ForbiddenException, NotFoundException} from '@nestjs/common';
import {FacilityService} from './facility.service';

const token = '11111111-1111-4111-8111-111111111111';
function fixture(facilityId = 'facility-1', orderStatus = 'in_transit_to_facility', qrActive = true, hasArrival = false) {
  const from = jest.fn((table: string) => {
    const query: any = {};
    for (const name of ['select', 'eq', 'limit', 'order']) query[name] = jest.fn(() => query);
    query.maybeSingle = jest.fn(async () => ({data: table === 'facility_employees' ? {facility_id: facilityId, employee_role: 'facility_employee'}
      : table === 'facilities' ? {id: facilityId, name: 'Local Facility', is_active: true}
      : table === 'order_qr_codes' ? {id: 'qr-1', order_id: 'order-1', is_active: qrActive, secure_token: token}
      : table === 'orders' ? {id: 'order-1', order_number: 'BW-1', facility_id: 'facility-1', current_status: orderStatus}
      : null, error: null}));
    query.then = (resolve: any) => Promise.resolve({
      data: table === 'driver_navigation_events'
        ? (hasArrival ? [{id: 'arrival-1'}, {id: 'arrival-2'}] : [])
        : [{item_name: 'Shirt', quantity: 2, weight_kg: 1}],
      error: null
    }).then(resolve);
    return query;
  });
  const rpc = jest.fn().mockResolvedValue({
    data: {orderId: 'order-1', operationId: 'op-1', facilityStatus: 'received', orderStatus: 'received_at_facility', pickupAssignmentStatus: 'delivered', received: true},
    error: null,
  });
  return {service: new FacilityService({admin: {from, rpc}, broadcastEvent: jest.fn()} as any), from, rpc};
}

describe('Facility intake preview', () => {
  it('resolves the assigned facility, order identity, and physical items without writing', async () => {
    const f = fixture();
    const preview = await f.service.previewReceipt('staff-1', `BW1:${token}`);
    expect(preview).toEqual({orderId: 'order-1', orderNumber: 'BW-1', orderStatus: 'in_transit_to_facility',
      facility: {id: 'facility-1', name: 'Local Facility'}, items: [{item_name: 'Shirt', quantity: 2, weight_kg: 1}]});
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalledWith('qr_scan_logs');
  });
  it('blocks wrong facility, inactive QR, and duplicate receipt state', async () => {
    await expect(fixture('facility-2').service.previewReceipt('staff-1', token)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(fixture('facility-1', 'in_transit_to_facility', false).service.previewReceipt('staff-1', token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(fixture('facility-1', 'received_at_facility').service.previewReceipt('staff-1', token)).rejects.toBeInstanceOf(ConflictException);
  });
  it('blocks receipt if driver has not confirmed arrival at facility', async () => {
    const f = fixture('facility-1', 'in_transit_to_facility', true, false);
    await expect(f.service.receiveByQr('staff-1', token)).rejects.toThrow(
      'Driver has not yet confirmed arrival at the facility',
    );
  });
  it('allows receipt when driver confirmed arrival even if duplicate arrival events exist', async () => {
    const f = fixture('facility-1', 'in_transit_to_facility', true, true);
    const result = await f.service.receiveByQr('staff-1', token);
    expect(result.received).toBe(true);
    expect(result.orderStatus).toBe('received_at_facility');
  });
});
