-- Migration: 60_20260928120000_cleanup_obsolete_auth_otp.sql
-- Description: Clean up obsolete custom phone login OTP storage and atomic functions.
-- Supabase Auth is the single authoritative OTP provider for user/customer login authentication.
-- Operational order pickup/delivery OTPs remain untouched in public.order_otps.

DROP FUNCTION IF EXISTS public.generate_phone_otp_atomic(text, text, interval, integer);
DROP FUNCTION IF EXISTS public.verify_phone_otp_atomic(text, text, text);
DROP TABLE IF EXISTS public.phone_auth_otps CASCADE;
