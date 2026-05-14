-- Migration 003: admin role + assessment runs
-- Adds is_admin to doctor_allowlist; creates assessment_runs table.
-- Applied: May 2026

alter table public.doctor_allowlist
  add column if not exists is_admin boolean not null default false;

update public.doctor_allowlist
  set is_admin = true
  where email = 'chiaweiwoo123@gmail.com';

-- ----

create table if not exists public.assessment_runs (
  run_id         text        primary key,
  triggered_by   text        not null default 'cli',
  created_at     timestamptz not null default now(),
  example_count  integer,
  base_url       text,
  organize_stats        jsonb,
  mode_stats            jsonb,
  blocked_reason_groups jsonb,
  reviewer_text  text,
  reviewer_model text,
  full_report    jsonb,
  status         text not null default 'completed'
);

create index if not exists assessment_runs_created_idx
  on public.assessment_runs (created_at desc);

alter table public.assessment_runs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'assessment_runs'
    and policyname = 'service role can manage assessment_runs'
  ) then
    create policy "service role can manage assessment_runs"
      on public.assessment_runs for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
