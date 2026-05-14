-- Migration 008: Add raw_results column to assessment_runs and update status vocabulary
-- Apply in Supabase SQL editor.

-- Add raw_results JSONB column to store full run data from assess:run step
ALTER TABLE assessment_runs
  ADD COLUMN IF NOT EXISTS raw_results jsonb;

-- status values: 'raw' (assess:run saved, no reviewer yet) | 'reviewed' (assess:review completed)
-- Existing rows with status='completed' are treated as reviewed for backward compat.
COMMENT ON COLUMN assessment_runs.status IS
  'raw = assess:run saved; reviewed = assess:review completed; completed = legacy (pre-008)';
