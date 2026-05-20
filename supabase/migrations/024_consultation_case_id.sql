alter table public.consultations
  add column if not exists case_id text,
  add column if not exists case_id_updated_at timestamptz;

create index if not exists consultations_doctor_case_id_idx
  on public.consultations (doctor_id, case_id)
  where case_id is not null and case_id <> '';

comment on column public.consultations.case_id is
  'Optional external case identifier entered by the doctor for linking related records. Not unique because source systems may duplicate IDs.';

comment on column public.consultations.case_id_updated_at is
  'Last update time for case_id.';
