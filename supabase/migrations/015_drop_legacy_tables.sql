-- Migration 015: Drop legacy tables no longer used by the application.
-- assessment_runs  → replaced by assessment_jobs + assessment_job_results
-- doctor_examples  → replaced by assessment_samples

DROP TABLE IF EXISTS assessment_runs CASCADE;
DROP TABLE IF EXISTS doctor_examples CASCADE;
