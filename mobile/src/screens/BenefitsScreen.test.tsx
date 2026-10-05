import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import BenefitsScreen from './BenefitsScreen';
import {getActiveOffers} from '../services/growthApi';

jest.mock('../services/growthApi', () => ({
  getActiveOffers: jest.fn(),
  getLoyaltyInfo: jest.fn(),
  getReferralInfo: jest.fn(),
}));

describe('customer offers screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getActiveOffers as jest.Mock).mockResolvedValue([]);
  });

  test('offers are loaded from server and show coupon and limits', async () => {
    (getActiveOffers as jest.Mock).mockResolvedValue([
      {
        id: 'offer',
        name: 'Laundry savings',
        coupon_code: 'SAVE10',
        discount_type: 'percentage',
        discount_value: 10,
        minimum_order_amount: 100,
        maximum_discount: 50,
      },
    ]);

    const onBack = jest.fn();
    const view = await render(
      <BenefitsScreen accessToken="token" onBack={onBack} />,
    );

    await waitFor(() => expect(view.getByText('Coupons & Offers')).toBeTruthy());
    expect(view.getByText('Laundry savings')).toBeTruthy();
    expect(view.getByText('SAVE10')).toBeTruthy();
    expect(
      view.getByText('10% OFF on orders from ₹100.00 · Max savings ₹50.00'),
    ).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  test('shows empty state when no offers are available', async () => {
    (getActiveOffers as jest.Mock).mockResolvedValue([]);
    const view = await render(
      <BenefitsScreen accessToken="token" onBack={jest.fn()} />,
    );
    await waitFor(() =>
      expect(view.getByText('No offers are available right now.')).toBeTruthy(),
    );
  });

  test('offers retry on error', async () => {
    (getActiveOffers as jest.Mock)
      .mockRejectedValueOnce(new Error('Offers offline'))
      .mockResolvedValueOnce([]);

    const view = await render(
      <BenefitsScreen accessToken="token" onBack={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByText('Offers offline')).toBeTruthy());

    await fireEvent.press(view.getByText('Retry offers'));
    await waitFor(() =>
      expect(view.getByText('No offers are available right now.')).toBeTruthy(),
    );
  });
});
