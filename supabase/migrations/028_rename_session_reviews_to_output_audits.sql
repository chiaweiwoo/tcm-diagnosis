-- Migration 028: Rename analytics_session_reviews → analytics_output_audits
--
-- Purpose: Aligns table name with new "AI Output Audit" feature (Goal 1 v2).
--          All existing session review rows are preserved under the new name.
--          The review JSONB column schema is backward-compatible (v1 rows lack
--          the "categories" key; the UI detects this and renders them as legacy).
--
-- Apply in Supabase SQL Editor. This does NOT run automatically.

ALTER TABLE analytics_session_reviews RENAME TO analytics_output_audits;

-- Rename self-referential FK constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analytics_session_reviews_prior_review_id_fkey'
  ) THEN
    ALTER TABLE analytics_output_audits
      RENAME CONSTRAINT analytics_session_reviews_prior_review_id_fkey
      TO analytics_output_audits_prior_review_id_fkey;
  END IF;
END $$;
