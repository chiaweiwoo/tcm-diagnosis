-- Migration 001: initial schema
-- Tables: consultations, api_call_logs, error_logs
-- Applied: project setup (May 2026)

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

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'consultations'
    and policyname = 'service role can manage consultations'
  ) then
    create policy "service role can manage consultations"
      on public.consultations for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

-- ----

create table if not exists public.api_call_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  route text not null,
  provider text not null default 'deepseek',
  model text,
  success boolean not null,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost_usd numeric,
  prompt_version text,
  error_message text,
  metadata jsonb
);

alter table public.api_call_logs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'api_call_logs'
    and policyname = 'service role can manage api_call_logs'
  ) then
    create policy "service role can manage api_call_logs"
      on public.api_call_logs for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

-- ----

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  level text not null default 'error',
  message text not null,
  details jsonb,
  request_id text,
  user_email text
);

alter table public.error_logs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'error_logs'
    and policyname = 'service role can manage error_logs'
  ) then
    create policy "service role can manage error_logs"
      on public.error_logs for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
