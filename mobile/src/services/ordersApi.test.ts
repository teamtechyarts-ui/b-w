import {
  getOrders,
  createOrder,
  cancelOrder,
  invalidateOrdersCache,
} from './ordersApi';
import { apiRequest } from './api';
import { clearSession } from './sessionManager';

jest.mock('./api', () => ({
  apiRequest: jest.fn(),
}));

jest.mock('./secureSessionStorage', () => ({
  clearSecureSession: jest.fn().mockResolvedValue(undefined),
  loadSecureSession: jest.fn().mockResolvedValue(null),
  saveSecureSession: jest.fn().mockResolvedValue(undefined),
}));

describe('ordersApi cache & user isolation', () => {
  const userAOrders = [
    { id: 'order-a1', order_number: 'BW-A1', current_status: 'placed', total_amount: 500 },
  ];
  const userBOrders = [
    { id: 'order-b1', order_number: 'BW-B1', current_status: 'delivered', total_amount: 850 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    invalidateOrdersCache();
  });

  afterEach(() => {
    invalidateOrdersCache();
  });

  it('caches order list for same token within 30s TTL', async () => {
    (apiRequest as jest.Mock).mockResolvedValueOnce(userAOrders);

    const first = await getOrders('token-user-a');
    expect(first).toEqual(userAOrders);
    expect(apiRequest).toHaveBeenCalledTimes(1);

    // Second call with same token returns cached result without apiRequest
    const second = await getOrders('token-user-a');
    expect(second).toEqual(userAOrders);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('prevents cross-user data leakage when switching users (different tokens)', async () => {
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce(userAOrders)
      .mockResolvedValueOnce(userBOrders);

    // User A fetches orders
    const ordersA = await getOrders('token-user-a');
    expect(ordersA).toEqual(userAOrders);
    expect(apiRequest).toHaveBeenCalledTimes(1);

    // User B fetches orders on the same device within 30s
    // Cache must NOT return User A's orders to User B!
    const ordersB = await getOrders('token-user-b');
    expect(ordersB).toEqual(userBOrders);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('bypasses cache when forceRefresh is true', async () => {
    const updatedA = [
      { id: 'order-a1', order_number: 'BW-A1', current_status: 'confirmed', total_amount: 500 },
    ];
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce(userAOrders)
      .mockResolvedValueOnce(updatedA);

    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(1);

    const refreshed = await getOrders('token-user-a', { forceRefresh: true });
    expect(refreshed).toEqual(updatedA);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on order creation', async () => {
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce(userAOrders)
      .mockResolvedValueOnce({ id: 'order-new' }) // createOrder response
      .mockResolvedValueOnce([...userAOrders, { id: 'order-new' }]); // next getOrders

    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await createOrder('token-user-a', {
      facilityId: 'fac-1',
      pickupAddressId: 'addr-1',
      deliveryAddressId: 'addr-1',
      pickupScheduledAt: '2026-10-15T10:00:00Z',
      pickupSlotLabel: 'Morning',
      paymentMethod: 'cash_on_delivery',
      termsAccepted: true,
      items: [{ serviceId: 's1', itemName: 'Shirt', quantity: 2 }],
    } as any);

    // Cache should have been invalidated by createOrder
    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('invalidates cache on order cancellation', async () => {
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce(userAOrders)
      .mockResolvedValueOnce({ cancelled: true }) // cancelOrder response
      .mockResolvedValueOnce([]); // next getOrders

    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await cancelOrder('token-user-a', 'order-a1', 'Duplicate order created by accident');

    // Cache should have been invalidated by cancelOrder
    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('invalidates cache when clearSession is executed upon logout', async () => {
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce(userAOrders)
      .mockResolvedValueOnce(userAOrders);

    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(1);

    // User logs out
    await clearSession();

    // Cache is cleared
    await getOrders('token-user-a');
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent in-flight getOrders requests', async () => {
    let resolveApi: (val: any) => void;
    const apiPromise = new Promise(resolve => {
      resolveApi = resolve;
    });
    (apiRequest as jest.Mock).mockReturnValue(apiPromise);

    // Two concurrent requests
    const p1 = getOrders('token-user-a');
    const p2 = getOrders('token-user-a');

    // apiRequest should only have been called ONCE
    expect(apiRequest).toHaveBeenCalledTimes(1);

    resolveApi!(userAOrders);
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toEqual(userAOrders);
    expect(res2).toEqual(userAOrders);
  });
});
