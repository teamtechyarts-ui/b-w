import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import CouponSection from './CouponSection';
import {getActiveOffers, validateCoupon} from '../services/growthApi';

jest.mock('../services/growthApi', () => ({getActiveOffers: jest.fn(), validateCoupon: jest.fn()}));
const offers = getActiveOffers as jest.MockedFunction<typeof getActiveOffers>;
const validate = validateCoupon as jest.MockedFunction<typeof validateCoupon>;

describe('checkout coupons', () => {
  beforeEach(() => {jest.clearAllMocks(); offers.mockResolvedValue([]);});
  it('shows empty offers, validates a code and allows removal', async () => {
    validate.mockResolvedValueOnce({offerId: 'offer-1', code: 'SAVE10', discount: 10});
    const change = jest.fn();
    const view = await render(<CouponSection accessToken="token" subtotal={100} applied={null} onChange={change} />);
    await waitFor(() => expect(view.getByText('No active offers right now.')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Coupon code'), 'SAVE10');
    await fireEvent.press(view.getByText('Apply'));
    await waitFor(() => expect(validate).toHaveBeenCalledWith('token', 'SAVE10', 100));
    expect(change).toHaveBeenCalledWith({offerId: 'offer-1', code: 'SAVE10', discount: 10});
    await view.rerender(<CouponSection accessToken="token" subtotal={100} applied={{offerId: 'offer-1', code: 'SAVE10', discount: 10}} onChange={change} />);
    await fireEvent.press(view.getByLabelText('Remove coupon'));
    expect(change).toHaveBeenCalledWith(null);
  });
  it('shows backend eligibility errors and does not apply invalid codes', async () => {
    validate.mockRejectedValueOnce(new Error('Minimum order value not met'));
    const change = jest.fn();
    const view = await render(<CouponSection accessToken="token" subtotal={100} applied={null} onChange={change} />);
    await fireEvent.press(view.getByText('Apply'));
    expect(view.getByText('Enter a coupon code.')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('Coupon code'), 'SAVE10');
    await fireEvent.press(view.getByText('Apply'));
    await waitFor(() => expect(view.getByText('Minimum order value not met')).toBeTruthy());
    expect(change).toHaveBeenCalledWith(null);
  });
});
