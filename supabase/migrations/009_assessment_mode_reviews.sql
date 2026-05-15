-- Migration 009: Add mode, example_reviews, section_reviews to assessment_runs
-- Apply in Supabase SQL editor.

ALTER TABLE assessment_runs
  ADD COLUMN IF NOT EXISTS mode text,
  ADD COLUMN IF NOT EXISTS example_reviews jsonb,
  ADD COLUMN IF NOT EXISTS section_reviews jsonb;

COMMENT ON COLUMN assessment_runs.mode IS 'Model mode used for this run: normal | smart';
COMMENT ON COLUMN assessment_runs.example_reviews IS 'Array of per-example DeepSeek quality scorecards from assess:review stage 1';
COMMENT ON COLUMN assessment_runs.section_reviews IS 'Object keyed by section name with cross-example consistency analyses from assess:review stage 2';
