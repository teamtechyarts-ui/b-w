// @ts-ignore
global.IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import ClaimsRefundsScreen from './ClaimsRefundsScreen';
import {getOrders} from '../services/ordersApi';
import {getOrderClaims} from '../services/claimsApi';
import {getPaymentSummary} from '../services/paymentsApi';

jest.mock('../services/ordersApi', () => ({
  getOrders: jest.fn(),
}));

jest.mock('../services/claimsApi', () => ({
  CLAIM_TYPES: [
    {value: 'damage', label: 'Damaged'},
    {value: 'missing_item', label: 'Missing item'},
    {value: 'quality', label: 'Wrong item or quality'},
    {value: 'delivery', label: 'Delivery issue'},
    {value: 'other', label: 'Other'},
  ],
  getOrderClaims: jest.fn(),
}));

jest.mock('../services/paymentsApi', () => ({
  getPaymentSummary: jest.fn(),
}));

describe('ClaimsRefundsScreen', () => {
  const onBack = jest.fn();
  const onOpenOrder = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getOrders as jest.Mock).mockReset();
    (getOrderClaims as jest.Mock).mockReset();
    (getPaymentSummary as jest.Mock).mockReset();
    (getOrders as jest.Mock).mockResolvedValue([]);
    (getOrderClaims as jest.Mock).mockResolvedValue([]);
    (getPaymentSummary as jest.Mock).mockResolvedValue({refunds: []});
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty state when customer has no claims, refunds, or cancellations', async () => {
    (getOrders as jest.Mock).mockResolvedValueOnce([
      {
        id: 'ord-1',
        order_number: 'BW-001',
        current_status: 'delivered',
        total_amount: 500,
        order_items: [{quantity: 2}],
      },
    ]);
    (getOrderClaims as jest.Mock).mockResolvedValueOnce([]);
    (getPaymentSummary as jest.Mock).mockResolvedValueOnce({
      orderId: 'ord-1',
      payment: {paymentOrderId: 'p-1', status: 'paid', amount: 50000, currency: 'INR'},
      refunds: [],
      refundEligibility: {eligible: true, remainingAmount: 500},
    });

    const view = await render(
      <ClaimsRefundsScreen
        accessToken="test-token"
        onBack={onBack}
        onOpenOrder={onOpenOrder}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('No Claims or Issues')).toBeTruthy();
      expect(view.queryByText('Loading claims & refunds...')).toBeNull();
    });

    // Check Back button
    fireEvent.press(view.getByLabelText('Go back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders claims, refunds, and cancellations and navigates to order details on tap', async () => {
    (getOrders as jest.Mock).mockResolvedValueOnce([
      {
        id: 'ord-101',
        order_number: 'BW-101',
        current_status: 'delivered',
        total_amount: 1200,
        order_items: [{quantity: 3}],
        created_at: '2026-10-01T10:00:00Z',
      },
      {
        id: 'ord-102',
        order_number: 'BW-102',
        current_status: 'cancelled',
        total_amount: 450,
        order_items: [{quantity: 1}],
        order_status_history: [
          {
            to_status: 'cancelled',
            reason: 'User requested cancellation before pickup',
            created_at: '2026-10-02T12:00:00Z',
          },
        ],
        created_at: '2026-10-02T10:00:00Z',
      },
    ]);

    (getOrderClaims as jest.Mock).mockImplementation((token, orderId) => {
      if (orderId === 'ord-101') {
        return Promise.resolve([
          {
            id: 'claim-1',
            status: 'under_review',
            claim_type: 'missing_item',
            description: 'Silk shirt was missing from delivery package',
            created_at: '2026-10-03T14:00:00Z',
            customer_claim_photos: [{id: 'photo-1', storage_path: 'p1.webp'}],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    (getPaymentSummary as jest.Mock).mockImplementation((token, orderId) => {
      if (orderId === 'ord-101') {
        return Promise.resolve({
          orderId: 'ord-101',
          payment: {paymentOrderId: 'pay-1', status: 'partially_refunded', amount: 120000, currency: 'INR'},
          refunds: [
            {
              refundRequestId: 'ref-1',
              amount: 300,
              reason: 'Silk shirt compensation',
              status: 'completed',
              cancellation: false,
            },
          ],
          refundEligibility: {eligible: true, remainingAmount: 900},
        });
      }
      return Promise.resolve({
        orderId: 'ord-102',
        payment: null,
        refunds: [],
        refundEligibility: {eligible: false, remainingAmount: 0},
      });
    });

    const view = await render(
      <ClaimsRefundsScreen
        accessToken="test-token"
        onBack={onBack}
        onOpenOrder={onOpenOrder}
      />,
    );

    // Wait for content to load
    await waitFor(() => {
      expect(view.getByText('Silk shirt was missing from delivery package')).toBeTruthy();
      expect(view.getByText('Missing item')).toBeTruthy();
      expect(view.getByText('Under Review')).toBeTruthy();
      expect(view.getByText('1 Photo')).toBeTruthy();
      expect(view.getByText('₹300.00')).toBeTruthy();
      expect(view.getByText('Reason: Silk shirt compensation')).toBeTruthy();
      expect(view.getByText('Reason: User requested cancellation before pickup')).toBeTruthy();
      expect(view.queryByText('Loading claims & refunds...')).toBeNull();
    });

    // Tap Claim -> opens Order Details
    fireEvent.press(view.getByLabelText('Claim for order BW-101, Missing item, Status Under Review'));
    expect(onOpenOrder).toHaveBeenCalledWith('ord-101');

    // Tap Tab: Claims
    fireEvent.press(view.getByLabelText('Claims tab'));
    expect(view.getAllByText('Claims (1)').length).toBeGreaterThan(0);

    // Tap Tab: Refunds
    fireEvent.press(view.getByLabelText('Refunds tab'));
    expect(view.getAllByText('Refunds (1)').length).toBeGreaterThan(0);

    // Tap Tab: Cancellations
    fireEvent.press(view.getByLabelText('Cancellations tab'));
    expect(view.getAllByText('Cancellations (1)').length).toBeGreaterThan(0);

    // Tap Cancellation item
    fireEvent.press(view.getByLabelText('Cancelled order BW-102, Total ₹450.00'));
    expect(onOpenOrder).toHaveBeenCalledWith('ord-102');
  });

  it('handles API failure gracefully with a retry option', async () => {
    (getOrders as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));

    const view = await render(
      <ClaimsRefundsScreen
        accessToken="test-token"
        onBack={onBack}
        onOpenOrder={onOpenOrder}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Network request failed')).toBeTruthy();
    });

    expect(view.getByText('Try again')).toBeTruthy();
  });
});
