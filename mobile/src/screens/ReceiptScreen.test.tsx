import React from 'react';
import {render, waitFor} from '@testing-library/react-native';
import ReceiptScreen from './ReceiptScreen';
import {getOrder} from '../services/ordersApi';
import {getPaymentSummary} from '../services/paymentsApi';

jest.mock('../services/ordersApi', () => ({getOrder: jest.fn()}));
jest.mock('../services/paymentsApi', () => ({getPaymentSummary: jest.fn()}));

const order = {
  id: 'order-1',
  order_number: 'BW-123',
  created_at: '2026-09-18T10:00:00Z',
  current_status: 'delivered',
  delivered_at: '2026-09-20T14:30:00Z',
  order_items: [
    {
      id: 'i1',
      item_name: 'Boots',
      quantity: 1,
      unit_price: 599,
      line_total: 599,
    },
  ],
  subtotal: 599,
  discount_amount: 0,
  pickup_delivery_charge: 0,
  taxable_amount: 599,
  gst_rate: 18,
  gst_amount: 107.82,
  total_amount: 706.82,
  payment_method: 'cash_on_delivery',
};

describe('ReceiptScreen', () => {
  test('historical receipt shows server GST and pricing without claiming a tax invoice', async () => {
    (getOrder as jest.Mock).mockResolvedValue(order);
    (getPaymentSummary as jest.Mock).mockResolvedValue({
      payment: null,
      refunds: [],
    });
    const view = await render(
      <ReceiptScreen accessToken="token" orderId="order-1" onBack={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByText('BW-123')).toBeTruthy());
    expect(view.getByText('GST (18%)')).toBeTruthy();
    expect(view.getByText('₹706.82')).toBeTruthy();
    expect(
      view.getByText('Receipt only. Tax invoice not available.'),
    ).toBeTruthy();
  });

  test('historical receipt remains visible if payment lookup fails', async () => {
    (getOrder as jest.Mock).mockResolvedValue(order);
    (getPaymentSummary as jest.Mock).mockRejectedValue(new Error('offline'));
    const view = await render(
      <ReceiptScreen accessToken="token" orderId="order-1" onBack={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByText('BW-123')).toBeTruthy());
  });

  test('receipt tolerates an absent historical payment method', async () => {
    (getOrder as jest.Mock).mockResolvedValue({
      ...order,
      payment_method: null,
    });
    (getPaymentSummary as jest.Mock).mockResolvedValue({
      payment: {status: 'partially_refunded'},
      refunds: [
        {
          refundRequestId: 'r1',
          amount: 1,
          status: 'completed',
        },
      ],
    });
    const view = await render(
      <ReceiptScreen accessToken="token" orderId="order-1" onBack={jest.fn()} />,
    );
    await waitFor(() =>
      expect(view.getByText('Not recorded')).toBeTruthy(),
    );
    expect(view.getByText('Partially refunded')).toBeTruthy();
    expect(view.getByText('Refund (Completed)')).toBeTruthy();
  });
});
