alter table public.consultations
  add column if not exists related_case_id text,
  add column if not exists related_case_id_updated_at timestamptz;

create index if not exists consultations_doctor_related_case_id_idx
  on public.consultations (doctor_id, related_case_id)
  where related_case_id is not null and related_case_id <> '';

comment on column public.consultations.related_case_id is
  'Optional external case identifier entered by the doctor to manually associate this consultation with another record.';

comment on column public.consultations.related_case_id_updated_at is
  'Last update time for related_case_id.';
