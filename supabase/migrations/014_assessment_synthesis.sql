-- Add synthesis + meta columns to assessment_jobs
ALTER TABLE assessment_jobs
  ADD COLUMN IF NOT EXISTS synthesis       jsonb,
  ADD COLUMN IF NOT EXISTS review_model    text,
  ADD COLUMN IF NOT EXISTS error_summary   text;

-- Add raw AI output column to assessment_job_results (for synthesis to inspect)
ALTER TABLE assessment_job_results
  ADD COLUMN IF NOT EXISTS analysis_raw jsonb;

-- Clear legacy calibration data (old workflow replaced)
TRUNCATE assessment_runs CASCADE;
