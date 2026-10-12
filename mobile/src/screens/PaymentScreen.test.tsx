import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import PaymentScreen from './PaymentScreen';
import type {CheckoutPricing} from '../utils/orderPricing';

const samplePricing: CheckoutPricing = {
  subtotal: 90,
  pickupDeliveryCharge: 40,
  hasFreeDelivery: false,
  amountUntilFreeDelivery: 160,
  discountAmount: 0,
  taxableAmount: 130,
  gstRate: 18,
  gstAmount: 23.4,
  grandTotal: 153.4,
};

describe('PaymentScreen Component', () => {
  it('renders payment method options and price summary', async () => {
    const onSelect = jest.fn();
    const onTerms = jest.fn();
    const onPlace = jest.fn();

    const view = await render(
      <PaymentScreen
        pricing={samplePricing}
        selectedPaymentMethod={null}
        termsAccepted={false}
        placingOrder={false}
        onBack={jest.fn()}
        onSelectPaymentMethod={onSelect}
        onTermsAcceptedChange={onTerms}
        onPlaceOrder={onPlace}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('GRAND TOTAL')).toBeTruthy();
      expect(view.getByText('₹153.40')).toBeTruthy();
      expect(view.getByText('Cash on Delivery')).toBeTruthy();
      expect(view.getByText('Online Payment')).toBeTruthy();
    });
  });

  it('allows selecting Cash on Delivery', async () => {
    const onSelect = jest.fn();
    const view = await render(
      <PaymentScreen
        pricing={samplePricing}
        selectedPaymentMethod={null}
        termsAccepted={false}
        placingOrder={false}
        onBack={jest.fn()}
        onSelectPaymentMethod={onSelect}
        onTermsAcceptedChange={jest.fn()}
        onPlaceOrder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByLabelText('Pay with Cash on Delivery')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Pay with Cash on Delivery'));
    expect(onSelect).toHaveBeenCalledWith('cash_on_delivery');
  });

  it('allows selecting Online Payment', async () => {
    const onSelect = jest.fn();
    const view = await render(
      <PaymentScreen
        pricing={samplePricing}
        selectedPaymentMethod={null}
        termsAccepted={false}
        placingOrder={false}
        onBack={jest.fn()}
        onSelectPaymentMethod={onSelect}
        onTermsAcceptedChange={jest.fn()}
        onPlaceOrder={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByLabelText('Pay Online via UPI, Cards, NetBanking')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Pay Online via UPI, Cards, NetBanking'));
    expect(onSelect).toHaveBeenCalledWith('razorpay');
  });

  it('displays inline error banner and retry/switch actions when errorMessage is provided', async () => {
    const onPlace = jest.fn();
    const onSelect = jest.fn();
    const onClear = jest.fn();

    const view = await render(
      <PaymentScreen
        pricing={samplePricing}
        selectedPaymentMethod="razorpay"
        termsAccepted={true}
        placingOrder={false}
        errorMessage="Online payment is temporarily unavailable. Please try again or choose Cash on Delivery."
        onClearError={onClear}
        onBack={jest.fn()}
        onSelectPaymentMethod={onSelect}
        onTermsAcceptedChange={jest.fn()}
        onPlaceOrder={onPlace}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Online payment unavailable')).toBeTruthy();
      expect(
        view.getByText(
          'Online payment is temporarily unavailable. Please try again or choose Cash on Delivery.',
        ),
      ).toBeTruthy();
    });

    // Tap Try Again
    await fireEvent.press(view.getByLabelText('Try payment again'));
    expect(onPlace).toHaveBeenCalled();

    // Tap Pay with COD instead
    await fireEvent.press(view.getByLabelText('Switch to Cash on Delivery'));
    expect(onSelect).toHaveBeenCalledWith('cash_on_delivery');
    expect(onClear).toHaveBeenCalled();
  });

  it('renders correctly with razorpay method and terms accepted', async () => {
    const view = await render(
      <PaymentScreen
        pricing={samplePricing}
        selectedPaymentMethod="razorpay"
        termsAccepted={true}
        placingOrder={false}
        onBack={jest.fn()}
        onSelectPaymentMethod={jest.fn()}
        onTermsAcceptedChange={jest.fn()}
        onPlaceOrder={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Terms accepted for this order.')).toBeTruthy();
      expect(view.getByLabelText('Pay ₹153.40')).toBeTruthy();
    });
  });
});
