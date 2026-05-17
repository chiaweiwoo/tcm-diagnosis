-- Migration 022: Drop legacy analytics and assessment tables
-- These tables were created in migrations 019-021 but the analytics/assessment
-- features were removed in Sprint 6 cleanup. Only analytics_doctor_evaluations
-- (Goal 1+2) is retained.
--
-- Run in Supabase SQL editor when ready to clean up the schema.

-- Drop dashboard view (depends on usage/performance tables)
DROP VIEW IF EXISTS analytics_doctor_dashboard;

-- Drop analytics tables no longer used
DROP TABLE IF EXISTS analytics_prompt_quality_runs;
DROP TABLE IF EXISTS analytics_usage_runs;
DROP TABLE IF EXISTS analytics_performance_runs;
DROP TABLE IF EXISTS analytics_admin_alerts;

-- Drop legacy assessment tables (if not already dropped in migration 015/018)
DROP TABLE IF EXISTS assessment_jobs;
DROP TABLE IF EXISTS assessment_job_results;
