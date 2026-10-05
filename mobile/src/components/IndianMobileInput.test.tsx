import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import IndianMobileInput from './IndianMobileInput';

describe('IndianMobileInput Component', () => {
  it('renders fixed +91 prefix and allows typing 10 digits', async () => {
    const onChangeText = jest.fn();
    const view = await render(
      <IndianMobileInput
        value=""
        onChangeText={onChangeText}
        label="Mobile Number"
      />,
    );

    await waitFor(() => {
      expect(view.getByText('+91')).toBeTruthy();
      expect(view.getByText('Mobile Number')).toBeTruthy();
    });

    const input = view.getByLabelText('Mobile number');
    await fireEvent.changeText(input, '9876543210');
    expect(onChangeText).toHaveBeenCalledWith('9876543210', '+919876543210');
  });

  it('automatically strips country code and non-digits when pasted', async () => {
    const onChangeText = jest.fn();
    const view = await render(
      <IndianMobileInput
        value=""
        onChangeText={onChangeText}
      />,
    );

    const input = view.getByLabelText('Mobile number');

    // Paste +91 98765 43210
    await fireEvent.changeText(input, '+91 98765 43210');
    expect(onChangeText).toHaveBeenCalledWith('9876543210', '+919876543210');

    // Paste with hyphens and letters
    await fireEvent.changeText(input, '98765-abc43210');
    expect(onChangeText).toHaveBeenCalledWith('9876543210', '+919876543210');
  });

  it('displays error message when provided', async () => {
    const view = await render(
      <IndianMobileInput
        value="12345"
        onChangeText={jest.fn()}
        error="Enter a valid 10-digit Indian mobile number."
      />,
    );

    await waitFor(() => {
      expect(
        view.getByText('Enter a valid 10-digit Indian mobile number.'),
      ).toBeTruthy();
    });
  });

  it('displays helper text when no error is present', async () => {
    const view = await render(
      <IndianMobileInput
        value=""
        onChangeText={jest.fn()}
        helperText="Enter 10-digit Indian mobile number. +91 is added automatically."
      />,
    );

    await waitFor(() => {
      expect(
        view.getByText(
          'Enter 10-digit Indian mobile number. +91 is added automatically.',
        ),
      ).toBeTruthy();
    });
  });
});
