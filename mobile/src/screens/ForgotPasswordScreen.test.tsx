import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import ForgotPasswordScreen from './ForgotPasswordScreen';
import * as authApi from '../services/authApi';

jest.mock('../services/authApi', () => ({
  requestPasswordReset: jest.fn(),
}));

describe('ForgotPasswordScreen', () => {
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

  it('sends reset link and shows confirmation without leaking account existence', async () => {
    (authApi.requestPasswordReset as jest.Mock).mockResolvedValueOnce({ sent: true });

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
    expect(view.getByText('Return to Sign In')).toBeTruthy();
  });
});
