import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import AdminGrowthScreen from './AdminGrowthScreen';
import {
  createAdminOffer,
  getAdminGrowth,
  setAdminOfferActive,
  updateAdminOffer,
} from '../services/adminGrowthApi';

jest.mock('../services/adminGrowthApi', () => ({
  getAdminGrowth: jest.fn(),
  createAdminOffer: jest.fn(),
  updateAdminOffer: jest.fn(),
  setAdminOfferActive: jest.fn(),
}));

const overview = {
  offers: [
    {
      id: 'o1',
      coupon_code: 'SAVE10',
      name: 'Special Sale',
      discount_type: 'fixed',
      discount_value: 10,
      minimum_order_amount: 100,
      maximum_discount: null,
      starts_at: null,
      expires_at: null,
      usage_limit: 2,
      is_active: true,
      eligibility_note: 'First 100 users',
      redeemedCount: 1,
      termsLocked: true,
    },
  ],
  redemptions: [
    {id: 'r1', offer_id: 'o1', discount_amount: 10, reversed_at: null},
  ],
  packages: [],
  subscriptions: [],
  eligibility: [],
  services: [],
  settings: {
    referral_enabled: true,
    referral_reward_points: 0,
    loyalty_earn_points_per_rupee: 0.01,
    loyalty_points_per_rupee: 10,
    loyalty_minimum_redemption_rupees: 100,
  },
  referrals: [],
  loyaltyHistory: [],
  audit: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (getAdminGrowth as jest.Mock).mockResolvedValue(overview);
  (createAdminOffer as jest.Mock).mockResolvedValue({});
  (updateAdminOffer as jest.Mock).mockResolvedValue({});
  (setAdminOfferActive as jest.Mock).mockResolvedValue({});
});

test('renders growth programs with summary and offer cards, toggles active state', async () => {
  const onBack = jest.fn();
  const view = await render(
    <AdminGrowthScreen accessToken="token" onBack={onBack} />,
  );

  await waitFor(() => expect(view.getByText('Growth Programs')).toBeTruthy());
  expect(view.getByText('Active Offers')).toBeTruthy();
  expect(view.getByText('Redemptions')).toBeTruthy();
  expect(view.getByText('SAVE10')).toBeTruthy();
  expect(view.getByText('Special Sale')).toBeTruthy();
  expect(view.getByText('ACTIVE')).toBeTruthy();

  // Toggle deactivation
  await fireEvent.press(view.getByText('Deactivate'));
  await waitFor(() =>
    expect(setAdminOfferActive).toHaveBeenCalledWith('token', 'o1', false),
  );
  await waitFor(() => expect(getAdminGrowth).toHaveBeenCalledTimes(2));

  // Back button
  await fireEvent.press(view.getByText('← Admin dashboard'));
  expect(onBack).toHaveBeenCalled();
});

test('opens create offer modal and creates an offer with real API', async () => {
  const view = await render(
    <AdminGrowthScreen accessToken="token" onBack={jest.fn()} />,
  );
  await waitFor(() => expect(view.getByText('+ Create Offer')).toBeTruthy());

  // Open modal
  await fireEvent.press(view.getByText('+ Create Offer'));
  await waitFor(() => expect(view.getByText('Create Offer')).toBeTruthy());

  await fireEvent.changeText(view.getByLabelText('Coupon code'), 'FIRSTUSER');
  await fireEvent.changeText(view.getByLabelText('Offer name'), 'First User');
  await fireEvent.changeText(view.getByLabelText('Discount value'), '50');
  await fireEvent.changeText(view.getByLabelText('Minimum order amount'), '250');
  await fireEvent.changeText(view.getByLabelText('Eligibility note'), 'New customers only');

  await fireEvent.press(view.getByText('Save Offer'));

  await waitFor(() =>
    expect(createAdminOffer).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        couponCode: 'FIRSTUSER',
        name: 'First User',
        discountValue: 50,
        minimumOrderAmount: 250,
        eligibilityNote: 'New customers only',
      }),
    ),
  );
});

test('opens edit offer modal and saves update', async () => {
  const view = await render(
    <AdminGrowthScreen accessToken="token" onBack={jest.fn()} />,
  );
  await waitFor(() => expect(view.getByText('Edit')).toBeTruthy());

  await fireEvent.press(view.getByText('Edit'));
  await waitFor(() => expect(view.getByText('Edit Offer')).toBeTruthy());

  await fireEvent.changeText(view.getByLabelText('Discount value'), '20');
  await fireEvent.press(view.getByText('Save Offer'));

  await waitFor(() =>
    expect(updateAdminOffer).toHaveBeenCalledWith(
      'token',
      'o1',
      expect.objectContaining({
        couponCode: 'SAVE10',
        discountValue: 20,
      }),
    ),
  );
});

test('shows error and retry when network fails', async () => {
  (getAdminGrowth as jest.Mock).mockRejectedValueOnce(new Error('Network unavailable'));
  const view = await render(
    <AdminGrowthScreen accessToken="token" onBack={jest.fn()} />,
  );
  await waitFor(() => expect(view.getByText('Network unavailable')).toBeTruthy());
  await fireEvent.press(view.getByText('Retry'));
  await waitFor(() => expect(view.getByText('Growth Programs')).toBeTruthy());
});
