import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import ForgotPasswordScreen from './ForgotPasswordScreen';
import * as authApi from '../services/authApi';

jest.mock('../services/authApi', () => ({
  requestPasswordReset: jest.fn(),
  verifyPasswordResetOtp: jest.fn(),
  confirmPasswordReset: jest.fn(),
}));

describe('ForgotPasswordScreen', () => {
  jest.setTimeout(15000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates email input', async () => {
    const view = await render(
      <ForgotPasswordScreen
        onBackToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Send Reset Link'));
    });
    expect(view.getByText('Please enter your email address')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'bademail');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Send Reset Link'));
    });
    expect(view.getByText('Please enter a valid email address')).toBeTruthy();
  });

  it('sends reset link and transitions to OTP verification without leaking account existence', async () => {
    (authApi.requestPasswordReset as jest.Mock).mockResolvedValueOnce({
      sent: true,
      message: 'If the account is eligible, a password-reset OTP will be sent to the registered email address.',
    });

    const view = await render(
      <ForgotPasswordScreen
        onBackToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'customer@example.com');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Send Reset Link'));
    });

    expect(authApi.requestPasswordReset).toHaveBeenCalledWith(
      'customer@example.com',
      expect.stringContaining('/auth/reset-password'),
    );
    expect(view.getByText('Check Your Email')).toBeTruthy();
    expect(view.getByText('Enter Verification Code')).toBeTruthy();
    expect(view.getByText('Verify Code')).toBeTruthy();
  });

  it('completes the full 4-step flow: Email -> OTP -> New Password -> Success', async () => {
    (authApi.requestPasswordReset as jest.Mock).mockResolvedValueOnce({
      sent: true,
    });
    (authApi.verifyPasswordResetOtp as jest.Mock).mockResolvedValueOnce({
      resetToken: 'valid-reset-token-123',
      message: 'OTP verified successfully.',
    });
    (authApi.confirmPasswordReset as jest.Mock).mockResolvedValueOnce({
      success: true,
      message: 'Password has been reset successfully.',
    });

    const onBackToLoginMock = jest.fn();

    const view = await render(
      <ForgotPasswordScreen
        onBackToLogin={onBackToLoginMock}
        onBack={jest.fn()}
      />,
    );

    // Step 1: Enter email
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'customer@example.com');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Send Reset Link'));
    });

    // Step 2: Enter OTP
    expect(view.getByText('Enter Verification Code')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('123456'), '654321');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Verify Code'));
    });
    expect(authApi.verifyPasswordResetOtp).toHaveBeenCalledWith('customer@example.com', '654321');

    // Step 3: Enter new password and confirmation
    expect(view.getByText('Set New Password')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('New Password'), 'NewSecurePass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm New Password'), 'NewSecurePass123!');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Reset Password'));
    });
    expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
      resetToken: 'valid-reset-token-123',
      newPassword: 'NewSecurePass123!',
      confirmPassword: 'NewSecurePass123!',
    });

    // Step 4: Success confirmation screen
    expect(view.getByText('Password Reset Successfully')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Return to Sign In'));
    });
    expect(onBackToLoginMock).toHaveBeenCalledTimes(1);
  });
});
