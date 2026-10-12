import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import OrderDetailsScreen from './OrderDetailsScreen';
import {getOrder, getOrderStatusHistory} from '../services/ordersApi';
import {getMyAddresses} from '../services/customersApi';
import {createCustomerOrderOtp} from '../services/orderOtpApi';

let orderRealtimeCallback: ((event: any) => void) | null = null;

jest.mock('../hooks/useRealtime', () => ({
  useOrderRealtime: jest.fn((orderId, callback) => {
    orderRealtimeCallback = callback;
  }),
}));
jest.mock('../services/ordersApi', () => ({
  getOrder: jest.fn(),
  getOrderStatusHistory: jest.fn(),
}));
jest.mock('../services/customersApi', () => ({getMyAddresses: jest.fn()}));
jest.mock('../services/orderOtpApi', () => ({
  ...jest.requireActual('../services/orderOtpApi'),
  createCustomerOrderOtp: jest.fn(),
}));
jest.mock('../components/OrderCareSection', () => () => null);
jest.mock('../components/OrderQrCard', () => () => null);
jest.mock('../services/orderTrackingApi', () => ({
  canCustomerTrackOrder: () => false,
  hasLiveDriverLocation: () => false,
}));

describe('OrderDetailsScreen', () => {
  const baseOrder = {
    id: 'order',
    order_number: 'BW-123',
    current_status: 'pickup_accepted',
    payment_method: null,
    order_items: [],
    pickup_address_id: 'private-address-id',
    delivery_address_id: 'private-address-id',
    total_amount: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderRealtimeCallback = null;
  });

  test('nullable payment method does not crash details and opaque address/provider ids are not rendered', async () => {
    (getOrder as jest.Mock).mockResolvedValue(baseOrder);
    (getOrderStatusHistory as jest.Mock).mockResolvedValue([
      {
        id: 'history',
        new_status: 'confirmed',
        created_at: '2026-09-21T00:00:00Z',
        reason: 'Provider payment captured (mock_payment_private)',
      },
    ]);
    (getMyAddresses as jest.Mock).mockResolvedValue([
      {id: 'private-address-id', address_line1: 'Road 12', city: 'Hyderabad'},
    ]);

    const view = await render(
      <OrderDetailsScreen
        accessToken="token"
        orderId="order"
        onBack={jest.fn()}
        onReceipt={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('Not recorded')).toBeTruthy());
    expect(view.getAllByText('Road 12, Hyderabad')).toHaveLength(2);
    expect(view.getByText('Payment received')).toBeTruthy();
    expect(view.queryByText('private-address-id')).toBeNull();
    expect(view.queryByText(/mock_payment_private/)).toBeNull();
  });

  test('valid delivery OTP displays code and expiry without regenerate button', async () => {
    const deliveryOrder = {
      ...baseOrder,
      current_status: 'delivery_otp_pending',
    };
    (getOrder as jest.Mock).mockResolvedValue(deliveryOrder);
    (getOrderStatusHistory as jest.Mock).mockResolvedValue([]);
    (getMyAddresses as jest.Mock).mockResolvedValue([]);
    (createCustomerOrderOtp as jest.Mock).mockResolvedValue({
      otpId: 'otp-123',
      otp: '552685',
      otpType: 'delivery',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      delivery: 'local_mock',
    });

    const view = await render(
      <OrderDetailsScreen
        accessToken="token"
        orderId="order"
        onBack={jest.fn()}
        onReceipt={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('DELIVERY OTP')).toBeTruthy());
    expect(view.getByText('552685')).toBeTruthy();
    expect(view.getByText(/Expires/)).toBeTruthy();
    expect(view.queryByText('Regenerate OTP')).toBeNull();
  });

  test('expired delivery OTP displays expired notice and inline Regenerate OTP button', async () => {
    const deliveryOrder = {
      ...baseOrder,
      current_status: 'delivery_otp_pending',
    };
    (getOrder as jest.Mock).mockResolvedValue(deliveryOrder);
    (getOrderStatusHistory as jest.Mock).mockResolvedValue([]);
    (getMyAddresses as jest.Mock).mockResolvedValue([]);
    (createCustomerOrderOtp as jest.Mock).mockResolvedValueOnce({
      otpId: 'otp-old',
      otp: '552685',
      otpType: 'delivery',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // expired 1 min ago
      delivery: 'local_mock',
    });

    const view = await render(
      <OrderDetailsScreen
        accessToken="token"
        orderId="order"
        onBack={jest.fn()}
        onReceipt={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(view.getByText('Your delivery OTP has expired.')).toBeTruthy(),
    );
    expect(view.getByText('Regenerate OTP')).toBeTruthy();

    // Now user taps Regenerate OTP
    (createCustomerOrderOtp as jest.Mock).mockResolvedValueOnce({
      otpId: 'otp-new',
      otp: '998877',
      otpType: 'delivery',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      delivery: 'local_mock',
    });

    await fireEvent.press(view.getByText('Regenerate OTP'));
    await waitFor(() => expect(view.getByText('998877')).toBeTruthy());
    expect(view.queryByText('Regenerate OTP')).toBeNull();
  });

  test('Pickup OTP customer screen detects realtime pickup verification and shows success confirmation', async () => {
    const pickupOrder = {
      ...baseOrder,
      current_status: 'pickup_otp_pending',
    };
    (getOrder as jest.Mock).mockResolvedValueOnce(pickupOrder);
    (getOrderStatusHistory as jest.Mock).mockResolvedValue([]);
    (getMyAddresses as jest.Mock).mockResolvedValue([]);
    (createCustomerOrderOtp as jest.Mock).mockResolvedValue({
      otpId: 'otp-pickup-1',
      otp: '123456',
      otpType: 'pickup',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      delivery: 'local_mock',
    });

    const view = await render(
      <OrderDetailsScreen
        accessToken="token"
        orderId="order"
        onBack={jest.fn()}
        onReceipt={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('PICKUP OTP')).toBeTruthy());
    expect(view.getByText('123456')).toBeTruthy();

    // Driver verifies OTP -> authoritative backend commit broadcasts status 'picked_up'
    const updatedOrder = {
      ...pickupOrder,
      current_status: 'picked_up',
    };
    (getOrder as jest.Mock).mockResolvedValue(updatedOrder);

    await act(async () => {
      if (orderRealtimeCallback) {
        orderRealtimeCallback({
          eventType: 'ORDER_STATUS_CHANGED',
          orderId: 'order',
          status: 'picked_up',
        });
      }
    });

    await waitFor(() => {
      expect(view.getByText('Pickup OTP Verified Successfully')).toBeTruthy();
    });
    expect(view.getByText('Your laundry has been picked up successfully.')).toBeTruthy();
    expect(view.getByText('VERIFIED')).toBeTruthy();
    expect(view.queryByText('PICKUP OTP')).toBeNull();

    // Duplicate event should not cause error or reset
    await act(async () => {
      if (orderRealtimeCallback) {
        orderRealtimeCallback({
          eventType: 'ORDER_STATUS_CHANGED',
          orderId: 'order',
          status: 'picked_up',
        });
      }
    });
    expect(view.getByText('Pickup OTP Verified Successfully')).toBeTruthy();
  });

  test('Delivery OTP customer screen detects realtime delivery verification and shows success confirmation', async () => {
    const deliveryOrder = {
      ...baseOrder,
      current_status: 'delivery_otp_pending',
    };
    (getOrder as jest.Mock).mockResolvedValueOnce(deliveryOrder);
    (getOrderStatusHistory as jest.Mock).mockResolvedValue([]);
    (getMyAddresses as jest.Mock).mockResolvedValue([]);
    (createCustomerOrderOtp as jest.Mock).mockResolvedValue({
      otpId: 'otp-delivery-1',
      otp: '654321',
      otpType: 'delivery',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      delivery: 'local_mock',
    });

    const view = await render(
      <OrderDetailsScreen
        accessToken="token"
        orderId="order"
        onBack={jest.fn()}
        onReceipt={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('DELIVERY OTP')).toBeTruthy());
    expect(view.getByText('654321')).toBeTruthy();

    // Driver verifies OTP -> authoritative backend commit broadcasts status 'claim_period_active'
    const updatedOrder = {
      ...deliveryOrder,
      current_status: 'claim_period_active',
    };
    (getOrder as jest.Mock).mockResolvedValue(updatedOrder);

    await act(async () => {
      if (orderRealtimeCallback) {
        orderRealtimeCallback({
          eventType: 'ORDER_STATUS_CHANGED',
          orderId: 'order',
          status: 'claim_period_active',
        });
      }
    });

    await waitFor(() => {
      expect(view.getByText('Delivery OTP Verified Successfully')).toBeTruthy();
    });
    expect(view.getByText('Your laundry has been delivered successfully.')).toBeTruthy();
    expect(view.getByText('VERIFIED')).toBeTruthy();
    expect(view.queryByText('DELIVERY OTP')).toBeNull();

    // Duplicate event should keep confirmation
    await act(async () => {
      if (orderRealtimeCallback) {
        orderRealtimeCallback({
          eventType: 'ORDER_STATUS_CHANGED',
          orderId: 'order',
          status: 'claim_period_active',
        });
      }
    });
    expect(view.getByText('Delivery OTP Verified Successfully')).toBeTruthy();
  });

  test('unrelated status update or initial load of completed order does not falsely trigger OTP verification animation', async () => {
    const completedOrder = {
      ...baseOrder,
      current_status: 'picked_up',
    };
    (getOrder as jest.Mock).mockResolvedValue(completedOrder);
    (getOrderStatusHistory as jest.Mock).mockResolvedValue([]);
    (getMyAddresses as jest.Mock).mockResolvedValue([]);

    const view = await render(
      <OrderDetailsScreen
        accessToken="token"
        orderId="order"
        onBack={jest.fn()}
        onReceipt={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.queryByText('Loading order details...')).toBeNull());
    expect(view.queryByText('Pickup OTP Verified Successfully')).toBeNull();
    expect(view.queryByText('Delivery OTP Verified Successfully')).toBeNull();
    expect(view.queryByText('PICKUP OTP')).toBeNull();
    expect(view.queryByText('DELIVERY OTP')).toBeNull();
  });
});
