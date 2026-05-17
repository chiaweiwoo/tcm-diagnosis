-- Migration 021: analytics_doctor_evaluations table
-- Stores Goal 1 (AI output review) + Goal 2 (doctor profile) per doctor per window.
-- Admin-only via service_role. No RLS policies = doctors cannot read this table.

CREATE TABLE IF NOT EXISTS analytics_doctor_evaluations (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id        UUID        NOT NULL REFERENCES auth.users(id),
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  consultation_count INT       NOT NULL DEFAULT 0,
  output_review    JSONB,   -- Goal 1: AI output quality findings
  doctor_profile   JSONB,   -- Goal 2: doctor pattern + gap analysis (includes internal_score)
  model            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (doctor_id, window_start, window_end)
);

ALTER TABLE analytics_doctor_evaluations ENABLE ROW LEVEL SECURITY;
-- No policies defined: service_role bypasses RLS (admin routes only).
-- Doctors must never be able to read their own internal_score or raw gap analysis.
