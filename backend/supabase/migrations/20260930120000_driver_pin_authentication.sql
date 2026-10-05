-- Migration: 20260930120000_driver_pin_authentication.sql
-- Description: Add driver_pin_hash column to public.drivers to store hashed permanent PINs for driver authentication.
-- Plaintext PINs are strictly prohibited. Operational pickup/delivery OTPs in public.order_otps remain untouched.

ALTER TABLE public.drivers
ADD COLUMN IF NOT EXISTS driver_pin_hash text;

COMMENT ON COLUMN public.drivers.driver_pin_hash IS 'Cryptographically hashed permanent driver PIN (PBKDF2-SHA512). Plaintext PIN is never stored.';
