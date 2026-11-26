-- Migration: Add nullable processing_started_at timestamp to public.notifications
-- for safe, bounded stale-processing recovery without modifying existing rows.
--
-- IMPORTANT: Review carefully and execute manually in the Supabase Dashboard
-- SQL Editor. Do not run automatically without review.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL;

COMMENT ON COLUMN public.notifications.processing_started_at IS
  'Timestamp when a worker atomically claimed this notification into processing; cleared on terminal status transition.';

CREATE INDEX IF NOT EXISTS idx_notifications_stale_processing
  ON public.notifications (processing_started_at)
  WHERE status = 'processing' AND processing_started_at IS NOT NULL;
