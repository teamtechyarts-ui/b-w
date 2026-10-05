import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import SignUpScreen from './SignUpScreen';
import * as authApi from '../services/authApi';

jest.mock('../services/authApi', () => ({
  signUpCustomer: jest.fn(),
}));

describe('SignUpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows error when full name is empty', async () => {
    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('Please enter your full name')).toBeTruthy();
  });

  it('shows error when email is invalid', async () => {
    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'John Doe');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'invalidemail');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('Please enter a valid email address')).toBeTruthy();
  });

  it('shows error when phone is invalid', async () => {
    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'John Doe');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'john@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Mobile Number'), '12345');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('Enter all 10 digits.')).toBeTruthy();
  });

  it('shows error when password is empty or short', async () => {
    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'John Doe');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'john@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Mobile Number'), '9876543210');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('Password is required')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Password'), '123');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('Password must be at least 6 characters long')).toBeTruthy();
  });

  it('shows error when passwords do not match', async () => {
    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'John Doe');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'john@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Mobile Number'), '9876543210');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'SecurePass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm Password'), 'DifferentPass!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('Passwords do not match')).toBeTruthy();
  });

  it('signs up customer with immediate session (Case A)', async () => {
    const onSessionEstablished = jest.fn();
    (authApi.signUpCustomer as jest.Mock).mockResolvedValueOnce({
      session: { access_token: 'immediate-token', refresh_token: 'refresh-token' },
      user: { id: 'usr-123', email: 'john@example.com' },
      profile: { id: 'usr-123', accountRole: 'customer' },
      requiresEmailConfirmation: false,
    });

    const view = await render(
      <SignUpScreen
        onSessionEstablished={onSessionEstablished}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'John Doe');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'john@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Mobile Number'), '9876543210');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'SecurePass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm Password'), 'SecurePass123!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(authApi.signUpCustomer).toHaveBeenCalledWith({
      fullName: 'John Doe',
      email: 'john@example.com',
      phone: '+919876543210',
      password: 'SecurePass123!',
    });
    expect(onSessionEstablished).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ access_token: 'immediate-token' }),
      }),
    );
  });

  it('handles email confirmation required state (Case B)', async () => {
    const onSessionEstablished = jest.fn();
    (authApi.signUpCustomer as jest.Mock).mockResolvedValueOnce({
      session: null,
      user: { id: 'usr-unconfirmed', email: 'jane@example.com' },
      profile: null,
      requiresEmailConfirmation: true,
      message: 'Account created successfully. Please check your email to verify your account.',
    });

    const view = await render(
      <SignUpScreen
        onSessionEstablished={onSessionEstablished}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'Jane Doe');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'jane@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Mobile Number'), '9876543211');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'SecurePass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm Password'), 'SecurePass123!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(
      view.getByText('Account created successfully. Please check your email to verify your account.'),
    ).toBeTruthy();
    expect(view.getByText('Go to Sign In')).toBeTruthy();
    expect(onSessionEstablished).not.toHaveBeenCalled();
  });

  it('displays friendly message on duplicate account', async () => {
    (authApi.signUpCustomer as jest.Mock).mockRejectedValueOnce(
      new Error('An account with this email already exists.'),
    );

    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Full Name'), 'Existing User');
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'existing@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Mobile Number'), '9876543212');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'SecurePass123!');
      fireEvent.changeText(view.getByPlaceholderText('Confirm Password'), 'SecurePass123!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });

    expect(view.getByText('An account with this email already exists.')).toBeTruthy();
  });

  it('navigates back to Sign In', async () => {
    const onNavigateToLogin = jest.fn();
    const view = await render(
      <SignUpScreen
        onSessionEstablished={jest.fn()}
        onNavigateToLogin={onNavigateToLogin}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });
    expect(onNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
