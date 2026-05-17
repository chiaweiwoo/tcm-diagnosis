-- Migration 023: Session reviews table + doctor evaluations cleanup
--
-- 1. Drop output_review column from analytics_doctor_evaluations
--    (AI output review moves to fleet-wide session reviews, not per-doctor)
-- 2. Drop the UNIQUE constraint so each on-demand run appends a new row
-- 3. Create analytics_session_reviews for fleet-wide prompt refinement runs
--
-- Run in Supabase SQL editor.

-- Drop output_review (now lives in analytics_session_reviews)
ALTER TABLE analytics_doctor_evaluations DROP COLUMN IF EXISTS output_review;

-- Drop unique constraint — evaluations are now append-only, not upsert-by-window
ALTER TABLE analytics_doctor_evaluations
  DROP CONSTRAINT IF EXISTS analytics_doctor_evaluations_doctor_id_window_start_window_end_key;

-- Fleet-wide session review table (prompt refinement, on-demand)
CREATE TABLE IF NOT EXISTS analytics_session_reviews (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  prior_review_id  UUID        NULL REFERENCES analytics_session_reviews(id) ON DELETE SET NULL,
  prompt_version_at_run TEXT   NOT NULL,
  sample_size      INT         NOT NULL,
  model            TEXT        NOT NULL,
  review           JSONB       NOT NULL
);

-- Index for "list latest" queries
CREATE INDEX IF NOT EXISTS idx_session_reviews_created_at
  ON analytics_session_reviews (created_at DESC);

-- No RLS — service_role access only via admin API routes
