-- Migration 029: doctor_risk_nudges
--
-- Purpose: Per-doctor table that stores the most-recent computed risk-nudge card
--          (AI 反复提醒的风险点). One row per doctor (upsert on doctor_id PK).
--          Computed by the daily cron job (POST /api/cron/risk-nudge) and on-demand
--          via `npm run nudge`.
--
-- Apply in Supabase SQL Editor. This does NOT run automatically.
-- https://supabase.com/dashboard/project/gegeuztvzecsikhxcvgl/sql/new

create table if not exists public.doctor_risk_nudges (
  doctor_id              uuid primary key references auth.users(id) on delete cascade,
  themes                 jsonb not null default '[]'::jsonb, -- [{key, count, examples[]}]
  window_start           timestamptz,
  window_end             timestamptz,
  source_last_record_at  timestamptz,  -- watermark = MAX(analyzed_at) at compute time
  case_count             int not null default 0,
  caution_count          int not null default 0,
  model                  text,
  prompt_version         text,
  computed_at            timestamptz not null default now()
);

-- Enable RLS (invariant 11)
alter table public.doctor_risk_nudges enable row level security;

-- Doctors can read only their own row (invariant 11)
create policy "doctor reads own nudge"
  on public.doctor_risk_nudges for select
  using (doctor_id = auth.uid());

-- Grants: mirror consultations pattern from migration 017 (invariant 11a)
-- authenticated = RLS-gated read only; service_role = full access; anon = nothing
grant select on public.doctor_risk_nudges to authenticated;
grant all    on public.doctor_risk_nudges to service_role;
-- anon intentionally omitted — per-doctor sensitive data
