import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import LoginScreen from './LoginScreen';
import * as authApi from '../services/authApi';

jest.mock('../services/authApi', () => ({
  signInCustomer: jest.fn(),
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows error when email is empty', async () => {
    const view = await render(
      <LoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToSignUp={jest.fn()}
        onNavigateToForgotPassword={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Please enter your email address')).toBeTruthy();
  });

  it('shows error when email format is invalid', async () => {
    const view = await render(
      <LoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToSignUp={jest.fn()}
        onNavigateToForgotPassword={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'notanemail');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Please enter a valid email address')).toBeTruthy();
  });

  it('shows error when password is empty', async () => {
    const view = await render(
      <LoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToSignUp={jest.fn()}
        onNavigateToForgotPassword={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'user@example.com');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Please enter your password')).toBeTruthy();
  });

  it('signs in customer successfully with valid credentials', async () => {
    const onSessionEstablished = jest.fn();
    (authApi.signInCustomer as jest.Mock).mockResolvedValueOnce({
      session: { access_token: 'valid-token', refresh_token: 'refresh-token' },
      user: { id: 'usr-1', email: 'user@example.com' },
      profile: { id: 'usr-1', accountRole: 'customer' },
    });

    const view = await render(
      <LoginScreen
        onSessionEstablished={onSessionEstablished}
        onNavigateToSignUp={jest.fn()}
        onNavigateToForgotPassword={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'user@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'SecurePass123!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(authApi.signInCustomer).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'SecurePass123!',
    });
    expect(onSessionEstablished).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ access_token: 'valid-token' }),
      }),
    );
  });

  it('displays friendly error message on invalid credentials', async () => {
    (authApi.signInCustomer as jest.Mock).mockRejectedValueOnce(
      new Error('Invalid email or password.'),
    );

    const view = await render(
      <LoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToSignUp={jest.fn()}
        onNavigateToForgotPassword={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'user@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'WrongPass!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Invalid email or password.')).toBeTruthy();
  });

  it('displays friendly error message when email is not confirmed', async () => {
    (authApi.signInCustomer as jest.Mock).mockRejectedValueOnce(
      new Error('Please verify your email before signing in.'),
    );

    const view = await render(
      <LoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToSignUp={jest.fn()}
        onNavigateToForgotPassword={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), 'unconfirmed@example.com');
      fireEvent.changeText(view.getByPlaceholderText('Password'), 'SecurePass123!');
    });

    await act(async () => {
      fireEvent.press(view.getByText('Sign In'));
    });

    expect(view.getByText('Please verify your email before signing in.')).toBeTruthy();
  });

  it('navigates to SignUp and ForgotPassword screens', async () => {
    const onNavigateToSignUp = jest.fn();
    const onNavigateToForgotPassword = jest.fn();

    const view = await render(
      <LoginScreen
        onSessionEstablished={jest.fn()}
        onNavigateToSignUp={onNavigateToSignUp}
        onNavigateToForgotPassword={onNavigateToForgotPassword}
        onBack={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Sign Up'));
    });
    expect(onNavigateToSignUp).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(view.getByText('Forgot Password?'));
    });
    expect(onNavigateToForgotPassword).toHaveBeenCalledTimes(1);
  });
});
