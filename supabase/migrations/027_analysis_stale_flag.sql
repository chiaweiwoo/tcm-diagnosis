-- Track whether form_data has been edited after the last analysis.
-- Cleared to false when a full re-analysis is saved.
-- Set to true when the API receives a formData-only update on an analyzed record.
-- This lets the UI show a stale-analysis banner across page reloads.

alter table public.consultations
  add column if not exists analysis_stale boolean not null default false;

comment on column public.consultations.analysis_stale is
  'True when form_data has been edited since the last analysis without a subsequent re-analysis. Cleared when a full analysis payload is saved.';
