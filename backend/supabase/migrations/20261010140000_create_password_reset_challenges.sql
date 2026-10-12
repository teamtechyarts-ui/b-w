-- Migration: 20261010140000_create_password_reset_challenges.sql
-- Description: Creates secure password reset challenge storage for Email OTP authentication.
-- Access: Service role only (backend admin). Anonymous and standard authenticated clients have no direct access.

CREATE TABLE IF NOT EXISTS public.password_reset_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'password_reset',
  expires_at TIMESTAMPTZ NOT NULL,
  resend_available_at TIMESTAMPTZ NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  reset_token_consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for efficient challenge lookups and throttle checks
CREATE INDEX IF NOT EXISTS idx_pwd_reset_email ON public.password_reset_challenges(email);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_user_id ON public.password_reset_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_active ON public.password_reset_challenges(email, consumed, expires_at);

-- Row Level Security
ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;

-- Deny direct access from public/anon/authenticated roles. Only service_role is granted access.
REVOKE ALL ON public.password_reset_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.password_reset_challenges TO service_role;
