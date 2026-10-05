import React from 'react';
import {cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import NotificationsScreen from './NotificationsScreen';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationsApi';

jest.mock('../services/notificationsApi', () => ({
  getNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  notificationOrderId: jest.requireActual('../services/notificationsApi').notificationOrderId,
  notificationOrderNumber: jest.requireActual('../services/notificationsApi').notificationOrderNumber,
}));

const mockNotifications = [
  {
    id: 'n-1',
    title: 'Driver has arrived',
    body: 'Driver arrived for Order BW-20261003-7CB85C51. Please provide the pickup OTP.',
    data: {
      orderId: 'order-uuid-1',
      orderNumber: 'BW-20261003-7CB85C51',
      action: 'provide_pickup_otp',
    },
    is_read: false,
    created_at: '2026-10-03T10:00:00Z',
  },
  {
    id: 'n-2',
    title: 'Ready for delivery',
    body: 'Order BW-TEST-709166 is clean, packed, and ready for delivery.',
    data: {
      orderId: 'order-uuid-2',
      orderNumber: 'BW-TEST-709166',
      action: 'view_order',
    },
    is_read: true,
    created_at: '2026-10-03T09:00:00Z',
  },
];

describe('NotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getNotifications as jest.Mock).mockResolvedValue(mockNotifications);
    (markNotificationRead as jest.Mock).mockImplementation(async (_token, id) => {
      const found = mockNotifications.find(n => n.id === id);
      return {...found, is_read: true};
    });
    (markAllNotificationsRead as jest.Mock).mockResolvedValue({updatedCount: 1});
  });

  afterEach(() => cleanup());

  it('renders order-specific notifications with clear order badges and answers WHO/WHAT/WHICH ORDER', async () => {
    const onOpenOrder = jest.fn();
    const view = await render(
      <NotificationsScreen
        accessToken="cust-token"
        onBack={jest.fn()}
        onOpenOrder={onOpenOrder}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Driver has arrived')).toBeTruthy();
      expect(view.getByText('Order BW-20261003-7CB85C51')).toBeTruthy();
      expect(view.getByText('Ready for delivery')).toBeTruthy();
      expect(view.getByText('Order BW-TEST-709166')).toBeTruthy();
    });
  });

  it('navigates directly to exact order on notification tap', async () => {
    const onOpenOrder = jest.fn();
    const view = await render(
      <NotificationsScreen
        accessToken="cust-token"
        onBack={jest.fn()}
        onOpenOrder={onOpenOrder}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Driver has arrived')).toBeTruthy();
    });

    await fireEvent.press(view.getByText('Driver has arrived'));

    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith('cust-token', 'n-1');
      expect(onOpenOrder).toHaveBeenCalledWith('order-uuid-1');
    });
  });

  it('supports mark all read action when unread notifications exist', async () => {
    const view = await render(
      <NotificationsScreen
        accessToken="cust-token"
        onBack={jest.fn()}
        onOpenOrder={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Mark all read')).toBeTruthy();
    });

    await fireEvent.press(view.getByText('Mark all read'));

    await waitFor(() => {
      expect(markAllNotificationsRead).toHaveBeenCalledWith('cust-token');
    });
  });
});
