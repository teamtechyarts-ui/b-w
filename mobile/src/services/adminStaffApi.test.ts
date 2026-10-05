import {activateAdminStaff, deactivateAdminStaff, listAdminStaff, provisionAdminStaff, reassignAdminStaffFacility, revokeAdminStaffAccess} from './adminStaffApi';
import {apiRequest} from './api';
jest.mock('./api', () => ({apiRequest: jest.fn()}));
const request = apiRequest as jest.Mock;
beforeEach(() => request.mockReset().mockResolvedValue({}));

test('searches and filters Admin staff through privileged endpoint', async () => {
  await listAdminStaff('admin-token', {search: 'Test Staff', role: 'driver', status: 'active'});
  expect(request).toHaveBeenCalledWith('/admin/staff?search=Test+Staff&role=driver&status=active', {accessToken: 'admin-token'});
});
test('staff provisioning validates phone, PIN, name and Facility; only uses Admin route', async () => {
  expect(() => provisionAdminStaff('t', {phone: '555', fullName: 'Test', role: 'driver', pin: '123456'})).toThrow('phone');
  expect(() => provisionAdminStaff('t', {phone: '+16505550177', fullName: 'Test', role: 'facility_employee', pin: '123456'})).toThrow('facility');
  expect(() => provisionAdminStaff('t', {phone: '+16505550177', fullName: 'Test', role: 'driver', pin: '123'})).toThrow('PIN');
  expect(request).not.toHaveBeenCalled();
  await provisionAdminStaff('t', {phone: '+16505550177', fullName: ' Fictional Driver ', role: 'driver', pin: '123456'});
  expect(request).toHaveBeenCalledWith('/admin/staff', {method: 'POST', accessToken: 't', body: {phone: '+16505550177', fullName: 'Fictional Driver', role: 'driver', pin: '123456'}});
});
test('activate, deactivate, revoke and reassign use existing Admin lifecycle', async () => {
  await deactivateAdminStaff('t', 'p1'); await activateAdminStaff('t', 'p1');
  await revokeAdminStaffAccess('t', 'p1'); await reassignAdminStaffFacility('t', 'p1', 'f1');
  expect(request.mock.calls.map(call => call[0])).toEqual([
    '/admin/staff/p1/deactivate', '/admin/staff/p1/activate',
    '/admin/staff/p1/revoke-access', '/admin/staff/p1/facility',
  ]);
});
