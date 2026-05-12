create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  doctor_email text not null,
  consultation_name text,
  draft text not null default '',
  organized_case jsonb,
  analysis_result jsonb,
  analysis_raw jsonb,
  validation_result jsonb,
  model_meta jsonb,
  analysis_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  analyzed_at timestamptz
);

create index if not exists consultations_doctor_updated_idx
on public.consultations (doctor_email, updated_at desc);

alter table public.consultations enable row level security;

drop policy if exists "service role can manage consultations" on public.consultations;

create policy "service role can manage consultations"
on public.consultations
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
