import {apiRequest} from './api';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationOrderId,
  notificationOrderNumber,
} from './notificationsApi';

jest.mock('./api', () => ({apiRequest: jest.fn()}));
const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('customer notifications api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts order ID and order number accurately', () => {
    expect(
      notificationOrderId({
        data: {orderId: 'order-123', orderNumber: 'BW-20261003-7CB85C51'},
      } as any),
    ).toBe('order-123');

    expect(
      notificationOrderNumber({
        title: 'Driver arrived for Order BW-20261003-7CB85C51',
        data: {orderNumber: 'BW-20261003-7CB85C51'},
      } as any),
    ).toBe('BW-20261003-7CB85C51');

    expect(
      notificationOrderNumber({
        title: 'Driver arrived for Order BW-TEST-709166',
        data: null,
      } as any),
    ).toBe('BW-TEST-709166');

    expect(notificationOrderId({data: {}} as any)).toBeNull();
    expect(notificationOrderNumber({title: 'Hello', data: {}} as any)).toBeNull();
  });

  it('loads notifications list successfully', async () => {
    const list = [
      {
        id: 'notif-1',
        title: 'Driver has arrived',
        body: 'Driver arrived for Order BW-20261003-7CB85C51',
        data: {orderId: 'order-1', orderNumber: 'BW-20261003-7CB85C51'},
        is_read: false,
      },
    ];
    mockedApiRequest.mockResolvedValueOnce(list);
    const res = await getNotifications('token-123');
    expect(res).toEqual(list);
    expect(mockedApiRequest).toHaveBeenCalledWith('/notifications', {
      accessToken: 'token-123',
    });
  });

  it('marks single notification read', async () => {
    mockedApiRequest.mockResolvedValueOnce({id: 'notif-1', is_read: true});
    const res = await markNotificationRead('token-123', 'notif-1');
    expect(res).toEqual({id: 'notif-1', is_read: true});
    expect(mockedApiRequest).toHaveBeenCalledWith('/notifications/notif-1/read', {
      method: 'POST',
      accessToken: 'token-123',
    });
  });

  it('marks all notifications read', async () => {
    mockedApiRequest.mockResolvedValueOnce({updatedCount: 3});
    const res = await markAllNotificationsRead('token-123');
    expect(res).toEqual({updatedCount: 3});
    expect(mockedApiRequest).toHaveBeenCalledWith('/notifications/read-all', {
      method: 'POST',
      accessToken: 'token-123',
    });
  });

  it('turns a malformed inbox response into the loading error state', async () => {
    mockedApiRequest.mockResolvedValueOnce({} as any);
    await expect(getNotifications('token')).rejects.toThrow(
      'Unable to load notifications',
    );
  });
});
