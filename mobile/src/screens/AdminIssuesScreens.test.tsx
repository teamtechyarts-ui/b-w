import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import AdminIssuesScreen from './AdminIssuesScreen';
import AdminIssueDetailScreen from './AdminIssueDetailScreen';
import {
  approveAdminRefund,
  decideAdminClaim,
  executeAdminClaimRefund,
  getAdminIssueOrder,
  listAdminIssues,
  rejectAdminRefund,
  requestAdminRefund,
} from '../services/adminIssuesApi';

jest.mock('../services/adminIssuesApi', () => ({
  listAdminIssues: jest.fn(),
  getAdminIssueOrder: jest.fn(),
  decideAdminClaim: jest.fn(),
  requestAdminRefund: jest.fn(),
  approveAdminRefund: jest.fn(),
  rejectAdminRefund: jest.fn(),
  executeAdminClaimRefund: jest.fn(),
}));
jest.mock('../services/claimsApi', () => ({
  deviceReachableUploadUrl: (url: string) => url,
}));

const queue = {
  claims: [
    {
      id: 'c1',
      order_id: 'o1',
      claim_type: 'missing_item',
      description: 'Items missing from order',
      status: 'submitted',
      created_at: '2026-10-08T10:00:00Z',
    },
  ],
  refunds: [],
  cancellations: [],
};

const detail = {
  order: {
    id: 'o1',
    order_number: 'BW-20261001-3F97A3B9',
    current_status: 'delivered',
    total_amount: 100,
    payment_method: 'online',
  },
  claims: [
    {
      ...queue.claims[0],
      customer_claim_photos: [
        {
          id: 'photo',
          storage_path: 'path',
          signedUrl: 'https://example.invalid/photo',
        },
      ],
    },
  ],
  payments: [
    {
      id: 'p1',
      order_id: 'o1',
      provider: 'mock',
      amount: 100,
      status: 'paid',
      refundableAmount: 90,
      refund_requests: [
        {
          id: 'r1',
          payment_order_id: 'p1',
          amount: 10,
          reason: 'Issue with item',
          status: 'requested',
          is_cancellation_refund: false,
          created_at: '2026-10-08T10:30:00Z',
        },
      ],
    },
  ],
  cancellationHistory: [],
  audit: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (listAdminIssues as jest.Mock).mockResolvedValue(queue);
  (getAdminIssueOrder as jest.Mock).mockResolvedValue(detail);
  (decideAdminClaim as jest.Mock).mockResolvedValue({});
  (requestAdminRefund as jest.Mock).mockResolvedValue({});
  (approveAdminRefund as jest.Mock).mockResolvedValue({});
  (rejectAdminRefund as jest.Mock).mockResolvedValue({});
});

describe('AdminIssuesScreens', () => {
  test('claims queue displays metrics, lists claims, and opens order details on click', async () => {
    const onOrder = jest.fn();
    const view = await render(
      <AdminIssuesScreen accessToken="token" onBack={jest.fn()} onOrder={onOrder} />,
    );
    await waitFor(() =>
      expect(view.getByText('Items missing from order')).toBeTruthy(),
    );
    expect(view.getByText('No refund requests')).toBeTruthy();
    expect(view.getByText('No cancellation requests')).toBeTruthy();
    expect(view.getByText('MISSING ITEM')).toBeTruthy();

    fireEvent.press(view.getByText('Items missing from order'));
    expect(onOrder).toHaveBeenCalledWith('o1');
  });

  test('queue error displays inline retry button', async () => {
    (listAdminIssues as jest.Mock).mockRejectedValueOnce(
      new Error('Network unavailable'),
    );
    const view = await render(
      <AdminIssuesScreen accessToken="token" onBack={jest.fn()} onOrder={jest.fn()} />,
    );
    await waitFor(() =>
      expect(view.getByText('Network unavailable')).toBeTruthy(),
    );
    fireEvent.press(view.getByText('Try again'));
    await waitFor(() =>
      expect(view.getByText('Items missing from order')).toBeTruthy(),
    );
  });

  test('detail displays claim info, evidence photos, and performs decisions with notes', async () => {
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByText('PHOTOS (1)')).toBeTruthy(),
    );
    expect(view.getByLabelText('Claim evidence photo')).toBeTruthy();

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'Photo reviewed and approved',
    );
    await fireEvent.press(view.getByText('Start Review'));
    await waitFor(() =>
      expect(decideAdminClaim).toHaveBeenCalledWith(
        'token',
        'o1',
        'c1',
        'under_review',
        'Photo reviewed and approved',
      ),
    );
    await waitFor(() => expect(getAdminIssueOrder).toHaveBeenCalledTimes(2));
  });

  test('refund requests can be approved and rejected by admin', async () => {
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByText('Available to refund: ₹90.00')).toBeTruthy(),
    );

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'Customer resolution note',
    );
    await fireEvent.changeText(
      view.getByLabelText('Refund amount for p1'),
      '20',
    );
    await fireEvent.press(view.getByText('Create Refund Request'));
    await waitFor(() =>
      expect(requestAdminRefund).toHaveBeenCalledWith(
        'token',
        'o1',
        'p1',
        20,
        'Customer resolution note',
      ),
    );

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'Approved refund request',
    );
    await fireEvent.press(view.getByText('Approve & Process Refund'));
    await waitFor(() =>
      expect(approveAdminRefund).toHaveBeenCalledWith(
        'token',
        'o1',
        'r1',
        'Approved refund request',
      ),
    );

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'Rejected refund request',
    );
    await fireEvent.press(view.getByText('Reject Refund'));
    await waitFor(() =>
      expect(rejectAdminRefund).toHaveBeenCalledWith(
        'token',
        'o1',
        'r1',
        'Rejected refund request',
      ),
    );
  });

  test('existing order with no claims shows friendly empty state', async () => {
    (getAdminIssueOrder as jest.Mock).mockResolvedValueOnce({
      ...detail,
      claims: [],
    });
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        view.getByText('No claim has been submitted for this order.'),
      ).toBeTruthy(),
    );
    expect(view.getByText('Order BW-20261001-3F97A3B9')).toBeTruthy();
  });

  test('nonexistent order shows Order not found error', async () => {
    (getAdminIssueOrder as jest.Mock).mockRejectedValueOnce(
      new Error('404 Order not found'),
    );
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="nonexistent"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() => expect(view.getByText('Order not found.')).toBeTruthy());
  });

  test('start review failure shows action-specific error below controls and preserves notes', async () => {
    (decideAdminClaim as jest.Mock).mockRejectedValueOnce(
      new Error('Could not find the function public.admin_review_customer_claim_atomic in the schema cache'),
    );
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByText('PHOTOS (1)')).toBeTruthy(),
    );

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'need to verify',
    );
    await fireEvent.press(view.getByText('Start Review'));

    await waitFor(() =>
      expect(
        view.getByText('Claim review is temporarily unavailable. Please try again later.'),
      ).toBeTruthy(),
    );
    // Notes should be preserved
    expect(view.getByDisplayValue('need to verify')).toBeTruthy();
  });

  test('short notes show validation error below decision controls', async () => {
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByText('PHOTOS (1)')).toBeTruthy(),
    );

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'ok',
    );
    await fireEvent.press(view.getByText('Start Review'));

    await waitFor(() =>
      expect(
        view.getByText('Please enter decision notes (minimum 3 characters).'),
      ).toBeTruthy(),
    );
    expect(decideAdminClaim).not.toHaveBeenCalled();
  });

  test('reject claim failure shows friendly error below controls', async () => {
    (decideAdminClaim as jest.Mock).mockRejectedValueOnce(
      new Error('Network error'),
    );
    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByText('PHOTOS (1)')).toBeTruthy(),
    );

    await fireEvent.changeText(
      view.getByLabelText('Admin decision notes'),
      'Item not eligible for claim',
    );
    await fireEvent.press(view.getByText('Reject Claim'));

    await waitFor(() =>
      expect(
        view.getByText('Network error'),
      ).toBeTruthy(),
    );
  });

  test('approved claim displays Issue Refund and Resolve Claim, opens modal and issues refund', async () => {
    (getAdminIssueOrder as jest.Mock).mockResolvedValue({
      ...detail,
      claims: [
        {
          ...detail.claims[0],
          status: 'approved',
          resolution_notes: 'Claim verified and approved by staff',
        },
      ],
    });
    (executeAdminClaimRefund as jest.Mock).mockResolvedValue({
      providerRefundId: 'rfnd_test123',
      status: 'processed',
    });

    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Issue Refund')).toBeTruthy();
      expect(view.getByText('Resolve Claim')).toBeTruthy();
    });

    // Open Refund Modal
    fireEvent.press(view.getByText('Issue Refund'));

    await waitFor(() => {
      expect(view.getByText('Issue Online Refund')).toBeTruthy();
      expect(view.getAllByText('Available to refund: ₹90.00').length).toBeGreaterThan(0);
    });

    // Submit refund via modal
    fireEvent.press(view.getByText('Confirm & Issue Refund'));

    await waitFor(() => {
      expect(executeAdminClaimRefund).toHaveBeenCalledWith(
        'token',
        'o1',
        'p1',
        90,
        'Claim verified and approved by staff',
      );
    });
  });

  test('Cash on Delivery approved claim displays manual reimbursement workflow', async () => {
    (getAdminIssueOrder as jest.Mock).mockResolvedValue({
      ...detail,
      order: {
        ...detail.order,
        payment_method: 'cash_on_delivery',
      },
      payments: [],
      claims: [
        {
          ...detail.claims[0],
          status: 'approved',
          resolution_notes: 'COD damaged item',
        },
      ],
    });

    const view = await render(
      <AdminIssueDetailScreen
        accessToken="token"
        orderId="o1"
        onBack={jest.fn()}
        onOrder={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Issue Refund')).toBeTruthy();
    });

    // Open Modal
    fireEvent.press(view.getByText('Issue Refund'));

    await waitFor(() => {
      expect(view.getByText('Record Manual Reimbursement')).toBeTruthy();
      expect(view.getByText('Cash on Delivery Notice')).toBeTruthy();
    });

    // Select UPI method
    await act(async () => {
      fireEvent.press(view.getByLabelText('Select upi method'));
    });

    // Confirm reimbursement
    await act(async () => {
      fireEvent.press(view.getByText('Confirm Manual Reimbursement'));
    });

    await waitFor(() => {
      expect(decideAdminClaim).toHaveBeenCalledWith(
        'token',
        'o1',
        'c1',
        'resolved',
        expect.stringContaining('[COD Manual Reimbursement - UPI]'),
      );
    });
  });
});

