-- Migration 034: add last_signin_at to doctor_allowlist for 3-day session expiry
-- Backfill existing rows with now() so current users get a fresh 3-day window.
-- Applied: run manually in Supabase SQL Editor.

alter table public.doctor_allowlist
  add column if not exists last_signin_at timestamptz;

update public.doctor_allowlist
  set last_signin_at = now()
  where last_signin_at is null;
