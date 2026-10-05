import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import ResetPasswordScreen from './ResetPasswordScreen';
import * as authApi from '../services/authApi';

jest.mock('../services/authApi', () => ({
  resetPassword: jest.fn(),
}));

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates password matching and length', async () => {
    const view = await render(
      <ResetPasswordScreen
        accessToken="recovery-token"
        onPasswordResetSuccess={jest.fn()}
        onBackToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Update Password'));
    });
    expect(view.getByText('Please enter a new password')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('New Password'), '123');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Update Password'));
    });
    expect(view.getByText('Password must be at least 6 characters long')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('New Password'), 'NewPass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm New Password'), 'Mismatch!');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Update Password'));
    });
    expect(view.getByText('Passwords do not match')).toBeTruthy();
  });

  it('submits updated password successfully', async () => {
    (authApi.resetPassword as jest.Mock).mockResolvedValueOnce({ success: true });
    const onSuccess = jest.fn();

    const view = await render(
      <ResetPasswordScreen
        accessToken="recovery-token"
        onPasswordResetSuccess={onSuccess}
        onBackToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('New Password'), 'NewSecurePass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm New Password'), 'NewSecurePass123!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Update Password'));
    });

    expect(authApi.resetPassword).toHaveBeenCalledWith('NewSecurePass123!', 'recovery-token');
    expect(view.getByText('Password Updated')).toBeTruthy();
    expect(view.getByText('Sign In')).toBeTruthy();
  });

  it('detects expired or invalid recovery link and offers retry', async () => {
    // Simulate window.location with otp_expired
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/auth/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired') as any;

    const onNavigateToForgot = jest.fn();
    const view = await render(
      <ResetPasswordScreen
        onPasswordResetSuccess={jest.fn()}
        onBackToLogin={jest.fn()}
        onBack={jest.fn()}
        onNavigateToForgotPassword={onNavigateToForgot}
      />,
    );

    expect(
      view.getByText(
        'This password reset link is invalid or has expired. Please request a new password reset link.',
      ),
    ).toBeTruthy();
    expect(view.getByText('Request New Reset Link')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText('Request New Reset Link'));
    });
    expect(onNavigateToForgot).toHaveBeenCalledTimes(1);
  });
});
