alter table public.consultations
  add column if not exists ai_feedback text,
  add column if not exists ai_feedback_updated_at timestamptz;

comment on column public.consultations.ai_feedback is
  'Optional doctor feedback about the AI analysis. Editable even after an analyzed consultation becomes read-only.';

comment on column public.consultations.ai_feedback_updated_at is
  'Last update time for ai_feedback.';
