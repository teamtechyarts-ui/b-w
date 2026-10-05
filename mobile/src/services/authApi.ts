import {apiRequest} from './api';
import type {AuthSessionResponse} from '../types/session';

type RequestOtpResponse = {
  success?: boolean;
  message?: string;
};

export type VerifyOtpResponse =
  AuthSessionResponse;

export async function requestPhoneOtp(
  phone: string,
): Promise<RequestOtpResponse> {
  return apiRequest<RequestOtpResponse>(
    '/auth/phone/request-otp',
    {
      method: 'POST',
      body: {
        phone,
      },
    },
  );
}

export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<VerifyOtpResponse> {
  return apiRequest<VerifyOtpResponse>(
    '/auth/phone/verify-otp',
    {
      method: 'POST',
      body: {
        phone,
        token,
      },
    },
  );
}

export async function getMyProfile(
  accessToken: string,
): Promise<unknown> {
  return apiRequest<unknown>(
    '/auth/me',
    {
      accessToken,
    },
  );
}

export async function refreshPhoneSession(
  refreshToken: string,
): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>(
    '/auth/refresh',
    {
      method: 'POST',
      body: {refreshToken},
      retryAuthentication: false,
    },
  );
}

export function getAccessTokenFromVerification(
  response: VerifyOtpResponse,
): string | null {
  return (
    response.session?.access_token ??
    response.access_token ??
    null
  );
}

export type SignUpCustomerPayload = {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
};

export type SignUpCustomerResponse = AuthSessionResponse & {
  requiresEmailConfirmation?: boolean;
  message?: string;
};

export async function signUpCustomer(
  payload: SignUpCustomerPayload,
): Promise<SignUpCustomerResponse> {
  return apiRequest<SignUpCustomerResponse>(
    '/auth/signup',
    {
      method: 'POST',
      body: payload,
    },
  );
}

export type SignInCustomerPayload = {
  email: string;
  password: string;
};

export async function signInCustomer(
  payload: SignInCustomerPayload,
): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>(
    '/auth/signin',
    {
      method: 'POST',
      body: payload,
    },
  );
}

export async function requestPasswordReset(
  email: string,
  redirectTo?: string,
): Promise<{sent: boolean}> {
  return apiRequest<{sent: boolean}>(
    '/auth/forgot-password',
    {
      method: 'POST',
      body: {
        email,
        ...(redirectTo ? {redirectTo} : {}),
      },
    },
  );
}

export async function resetPassword(
  password: string,
  accessToken: string,
): Promise<{success: boolean}> {
  return apiRequest<{success: boolean}>(
    '/auth/reset-password',
    {
      method: 'POST',
      body: {password},
      accessToken,
    },
  );
}

export type SignInDriverPayload = {
  phone: string;
  pin: string;
};

export type SignInStaffPinPayload = {
  phone: string;
  pin: string;
};

export async function signInDriver(
  payload: SignInDriverPayload,
): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>(
    '/auth/driver/signin',
    {
      method: 'POST',
      body: payload,
    },
  );
}

export async function signInFacilityEmployee(
  payload: SignInStaffPinPayload,
): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>(
    '/auth/facility/signin',
    {
      method: 'POST',
      body: payload,
    },
  );
}

export async function signInStaffPin(
  payload: SignInStaffPinPayload,
): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>(
    '/auth/staff/signin',
    {
      method: 'POST',
      body: payload,
    },
  );
}


