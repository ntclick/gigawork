-- Migration: Add notification fields to deployments table
-- Run this against your Supabase/Postgres database
-- Date: 2026-08-07

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS notify_channels TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS notify_email TEXT,
  ADD COLUMN IF NOT EXISTS notify_telegram_id TEXT;

-- Optional: add a comment for documentation
COMMENT ON COLUMN deployments.notify_channels IS 'Notification channels: none | email | telegram | both';
COMMENT ON COLUMN deployments.notify_email IS 'Per-deployment email override (null = use user profile email)';
COMMENT ON COLUMN deployments.notify_telegram_id IS 'Per-deployment Telegram chat ID override (null = use user profile)';
