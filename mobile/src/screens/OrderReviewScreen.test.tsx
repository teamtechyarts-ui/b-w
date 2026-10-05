import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import OrderReviewScreen from './OrderReviewScreen';
import {getActiveOffers, getLoyaltyInfo} from '../services/growthApi';
import {getMyPackages} from '../services/packagesApi';
import {checkOrderServiceability} from '../services/ordersApi';

jest.mock('../services/growthApi', () => ({getActiveOffers: jest.fn(), getLoyaltyInfo: jest.fn(), validateCoupon: jest.fn()}));
jest.mock('../services/packagesApi', () => ({getMyPackages: jest.fn()}));
jest.mock('../services/ordersApi', () => ({checkOrderServiceability: jest.fn()}));
const offers = getActiveOffers as jest.MockedFunction<typeof getActiveOffers>;
const loyalty = getLoyaltyInfo as jest.MockedFunction<typeof getLoyaltyInfo>;
const checkService = checkOrderServiceability as jest.MockedFunction<typeof checkOrderServiceability>;

describe('order review rewards summary', () => {
  beforeEach(() => {
    checkService.mockResolvedValue({
      serviceable: true,
      facilityId: 'fac-1',
      facilityName: 'Central Facility',
      pincode: '500068',
    });
  });

  it('shows coupon discount in the final estimate', async () => {
    offers.mockResolvedValue([]);
    loyalty.mockResolvedValue({balance: 0, transactions: []});
    (getMyPackages as jest.Mock).mockResolvedValue([]);
    const view = await render(<OrderReviewScreen
      selectedAddress={null} pickupDateLabel="Tomorrow" pickupSlotLabel="Morning"
      cartItems={[]} cartSubtotal={400} accessToken="token"
      coupon={{offerId: 'offer-1', code: 'SAVE10', discount: 10}}
      onCouponChange={jest.fn()} loyaltyPoints={0} onLoyaltyPointsChange={jest.fn()}
      selectedPackage={null} onPackageChange={jest.fn()}
      onBack={jest.fn()} onChangeAddress={jest.fn()} onChangePickupTime={jest.fn()}
      onContinueToPayment={jest.fn()}
    />);
    await waitFor(() => expect(view.getByText('Coupon discount')).toBeTruthy());
    expect(view.getByText('-₹10.00')).toBeTruthy();
    expect(view.getAllByText(/462.00/).length).toBeGreaterThan(0);
  });

  it('blocks continuing below the server minimum order amount', async () => {
    offers.mockResolvedValue([]); loyalty.mockResolvedValue({balance: 0, transactions: []});
    (getMyPackages as jest.Mock).mockResolvedValue([]);
    const onContinue = jest.fn();
    const view = await render(<OrderReviewScreen selectedAddress={null} pickupDateLabel="Tomorrow" pickupSlotLabel="Morning"
      cartItems={[]} cartSubtotal={400} pricingPolicy={{pickupDeliveryFee: 50, freeDeliveryThreshold: 500, gstRatePercent: 5, minimumOrderAmount: 450}}
      accessToken="token" coupon={null} onCouponChange={jest.fn()} loyaltyPoints={0} onLoyaltyPointsChange={jest.fn()}
      selectedPackage={null} onPackageChange={jest.fn()}
      onBack={jest.fn()} onChangeAddress={jest.fn()}
      onChangePickupTime={jest.fn()} onContinueToPayment={onContinue} />);
    await waitFor(() => expect(view.getByText('Minimum order ₹450.00.')).toBeTruthy());
    await fireEvent.press(view.getByText(/Continue to Payment/));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows service available feedback for valid serviceable pincode', async () => {
    offers.mockResolvedValue([]); loyalty.mockResolvedValue({balance: 0, transactions: []});
    (getMyPackages as jest.Mock).mockResolvedValue([]);
    const validAddress: any = {
      id: 'addr-1',
      label: 'Home',
      address_line1: 'Road No 10',
      postal_code: '500068',
      city: 'Hyderabad',
      state: 'Telangana',
    };
    const view = await render(<OrderReviewScreen
      selectedAddress={validAddress} pickupDateLabel="Tomorrow" pickupSlotLabel="Morning"
      cartItems={[]} cartSubtotal={400} accessToken="token"
      coupon={null} onCouponChange={jest.fn()} loyaltyPoints={0} onLoyaltyPointsChange={jest.fn()}
      selectedPackage={null} onPackageChange={jest.fn()}
      onBack={jest.fn()} onChangeAddress={jest.fn()} onChangePickupTime={jest.fn()}
      onContinueToPayment={jest.fn()}
    />);
    await waitFor(() => expect(view.getByText('Service available in your area')).toBeTruthy());
    expect(view.getByText('Central Facility')).toBeTruthy();
  });

  it('prompts to update address when address has invalid/missing pincode', async () => {
    offers.mockResolvedValue([]); loyalty.mockResolvedValue({balance: 0, transactions: []});
    (getMyPackages as jest.Mock).mockResolvedValue([]);
    const addressWithoutPincode: any = {
      id: 'addr-2',
      label: 'Office',
      address_line1: 'Building B',
      postal_code: '',
    };
    const view = await render(<OrderReviewScreen
      selectedAddress={addressWithoutPincode} pickupDateLabel="Tomorrow" pickupSlotLabel="Morning"
      cartItems={[]} cartSubtotal={400} accessToken="token"
      coupon={null} onCouponChange={jest.fn()} loyaltyPoints={0} onLoyaltyPointsChange={jest.fn()}
      selectedPackage={null} onPackageChange={jest.fn()}
      onBack={jest.fn()} onChangeAddress={jest.fn()} onChangePickupTime={jest.fn()}
      onContinueToPayment={jest.fn()}
    />);
    await waitFor(() => expect(view.getByText('Pincode required')).toBeTruthy());
    expect(view.getByText('Please enter a valid 6-digit pincode for your pickup address.')).toBeTruthy();
    expect(view.getByText('Update Address')).toBeTruthy();
  });

  it('shows outside service area and disables continue when pincode is not serviceable', async () => {
    offers.mockResolvedValue([]); loyalty.mockResolvedValue({balance: 0, transactions: []});
    (getMyPackages as jest.Mock).mockResolvedValue([]);
    checkService.mockResolvedValueOnce({
      serviceable: false,
      reason: 'OUTSIDE_SERVICE_AREA',
      pincode: '500099',
      message: 'We currently do not provide pickup and delivery service in this pincode.',
    });
    const unserviceableAddress: any = {
      id: 'addr-3',
      label: 'Farmhouse',
      address_line1: 'Highway 44',
      postal_code: '500099',
    };
    const onContinue = jest.fn();
    const view = await render(<OrderReviewScreen
      selectedAddress={unserviceableAddress} pickupDateLabel="Tomorrow" pickupSlotLabel="Morning"
      cartItems={[]} cartSubtotal={400} accessToken="token"
      coupon={null} onCouponChange={jest.fn()} loyaltyPoints={0} onLoyaltyPointsChange={jest.fn()}
      selectedPackage={null} onPackageChange={jest.fn()}
      onBack={jest.fn()} onChangeAddress={jest.fn()} onChangePickupTime={jest.fn()}
      onContinueToPayment={onContinue}
    />);
    await waitFor(() => expect(view.getByText('Service not available')).toBeTruthy());
    expect(view.getByText('We currently do not provide pickup and delivery service in this pincode.')).toBeTruthy();

    await fireEvent.press(view.getByText('Service Unavailable'));
    expect(onContinue).not.toHaveBeenCalled();
  });
});
