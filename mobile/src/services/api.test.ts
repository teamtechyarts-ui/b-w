import {API_TIMEOUT_MS, apiRequest} from './api';
jest.mock('../config/environment', () => ({API_BASE_URL: 'http://localhost:3000/v1'}));
jest.mock('./sessionManager', () => ({getStoredSession: jest.fn(() => null), refreshStoredSession: jest.fn()}));

afterEach(() => {jest.useRealTimers(); jest.restoreAllMocks();});
test('offline errors are readable and do not expose request details', async () => {
  globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('network failed'));
  await expect(apiRequest('/orders')).rejects.toThrow('Network unavailable');
});
test('stalled writes time out without automatically retrying', async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  const request = apiRequest('/orders', {method: 'POST', body: {items: []}});
  await Promise.all([
    jest.advanceTimersByTimeAsync(API_TIMEOUT_MS),
    expect(request).rejects.toThrow('Check your orders before retrying'),
  ]);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('stalled read requests give connection guidance rather than order-submission warnings', async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  const request = apiRequest('/services');
  await Promise.all([
    jest.advanceTimersByTimeAsync(API_TIMEOUT_MS),
    expect(request).rejects.toThrow('Check your connection and try again'),
  ]);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('HTTP 404 does not throw network unavailable and provides meaningful error', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({
      message: 'Cannot GET /v1/admin/staff/3167f33a-89a6-4e39-960a-db47327304cb/driver-pin',
      error: 'Not Found',
      statusCode: 404,
    }),
  } as Response);
  await expect(apiRequest('/admin/staff/123/driver-pin')).rejects.toThrow('Driver operation is not available.');
});

test('HTTP errors preserve backend error messages for 400, 401, 403, 409, 429, 500', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ message: 'Driver PIN must be exactly 6 digits' }),
  } as Response);
  await expect(apiRequest('/test')).rejects.toThrow('Driver PIN must be exactly 6 digits');

  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => null,
  } as Response);
  await expect(apiRequest('/test')).rejects.toThrow('Insufficient permissions to perform this operation.');

  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => null,
  } as Response);
  await expect(apiRequest('/test')).rejects.toThrow('Internal server error. Please try again.');
});

