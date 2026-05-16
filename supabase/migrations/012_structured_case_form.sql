-- Migration 012: structured case form
-- Replace free-text draft fields with structured form_data JSONB.
-- Applied: May 2026 — product pivot from organize→analyze to direct structured input.

-- Drop columns that belong to the old two-step (draft → organize → analyze) pipeline.
-- consultations table previously had: draft text, organized_case jsonb, validation_result jsonb
alter table public.consultations
  drop column if exists draft,
  drop column if exists organized_case,
  drop column if exists validation_result;

-- Add the new structured form data column.
alter table public.consultations
  add column if not exists form_data jsonb;

-- consultations.analysis_status values remain the same: 'draft' | 'analyzed'
-- consultations.analysis_result, analysis_raw, model_meta — unchanged
