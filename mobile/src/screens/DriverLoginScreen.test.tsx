import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import DriverLoginScreen from './DriverLoginScreen';
import { signInStaffPin } from '../services/authApi';

jest.mock('../services/authApi', () => ({
  signInStaffPin: jest.fn(),
}));

describe('DriverLoginScreen (Staff Login)', () => {
  beforeEach(() => {
    (signInStaffPin as jest.Mock).mockReset();
  });

  it('renders Staff Login title, fixed +91 prefix, and 6-digit PIN input', async () => {
    const view = await render(
      <DriverLoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToCustomerLogin={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Staff Login')).toBeTruthy();
      expect(
        view.getByText('Sign in to your Bright & White staff account'),
      ).toBeTruthy();
      expect(view.getByText('+91')).toBeTruthy();
      expect(view.getByText('6-Digit PIN')).toBeTruthy();
      expect(view.getByText('Sign In')).toBeTruthy();
    });
  });

  it('validates 10-digit Indian mobile number', async () => {
    const view = await render(
      <DriverLoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToCustomerLogin={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Mobile number'), '12345');
      fireEvent.changeText(view.getByLabelText('6-Digit PIN'), '123456');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Enter all 10 digits.')).toBeTruthy();
    expect(signInStaffPin).not.toHaveBeenCalled();
  });

  it('validates 6-digit PIN', async () => {
    const view = await render(
      <DriverLoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToCustomerLogin={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Mobile number'), '9876543210');
      fireEvent.changeText(view.getByLabelText('6-Digit PIN'), '123');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Please enter your 6-digit PIN')).toBeTruthy();
    expect(signInStaffPin).not.toHaveBeenCalled();
  });

  it('submits canonical E.164 (+919876543210) upon valid submission', async () => {
    const onSession = jest.fn();
    (signInStaffPin as jest.Mock).mockResolvedValueOnce({
      session: { access_token: 'staff-token' },
      user: { id: 'staff-1' },
      profile: { accountRole: 'driver', fullName: 'Ramesh' },
    });

    const view = await render(
      <DriverLoginScreen
        onSessionEstablished={onSession}
        onNavigateToCustomerLogin={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Mobile number'), '9876543210');
      fireEvent.changeText(view.getByLabelText('6-Digit PIN'), '654321');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(signInStaffPin).toHaveBeenCalledWith({
      phone: '+919876543210',
      pin: '654321',
    });
    expect(onSession).toHaveBeenCalled();
  });

  it('navigates to customer login when tapped', async () => {
    const onNavCustomer = jest.fn();
    const view = await render(
      <DriverLoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToCustomerLogin={onNavCustomer}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Customer / Admin Login →'));
    });

    expect(onNavCustomer).toHaveBeenCalled();
  });
});
