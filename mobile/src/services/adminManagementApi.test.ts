import {cancelAdminOrder, getAdminCustomers, getAdminOrder, lookupAdminQr} from './adminManagementApi';
import {apiRequest} from './api';
jest.mock('./api', () => ({apiRequest: jest.fn()}));
const request = apiRequest as jest.Mock;
beforeEach(() => request.mockReset().mockResolvedValue([]));

test('Admin search encodes user input and uses role-scoped routes', async () => {
  await getAdminCustomers('token', 'A & B');
  expect(request).toHaveBeenCalledWith('/admin/customers?search=A%20%26%20B', {accessToken: 'token'});
  await getAdminOrder('token', 'order-1');
  expect(request).toHaveBeenCalledWith('/admin/orders/order-1', {accessToken: 'token'});
});
test('Admin cancellation requires a reason and never calls customer cancellation route', async () => {
  expect(() => cancelAdminOrder('token', 'order-1', ' ')).toThrow('cancellation reason');
  expect(request).not.toHaveBeenCalled();
  await cancelAdminOrder('token', 'order-1', 'Customer requested cancellation');
  expect(request).toHaveBeenCalledWith('/admin/orders/order-1/cancel', {method: 'POST', accessToken: 'token', body: {reason: 'Customer requested cancellation'}});
});
test('Admin QR lookup validates the BW1 payload and uses audited staff scan', async () => {
  await expect(lookupAdminQr('token', 'garbage')).rejects.toThrow('valid BW1');
  const id = '00000000-0000-4000-8000-000000000001';
  await lookupAdminQr('token', `BW1:${id}`);
  expect(request).toHaveBeenCalledWith('/qr/scan', {method: 'POST', accessToken: 'token', body: {token: id, action: 'lookup'}});
});
