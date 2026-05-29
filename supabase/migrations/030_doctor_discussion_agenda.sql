-- Migration 030: doctor_discussion_agenda
--
-- Purpose: Per-doctor table that stores the pre-computed weekly discussion agenda
--          (讨论清单). One row per doctor (upsert on doctor_id PK).
--          Computed by the weekly cron job (POST /api/cron/discussion-agenda) and on-demand
--          via `npm run discussion`.
--
-- Apply in Supabase SQL Editor. This does NOT run automatically.
-- https://supabase.com/dashboard/project/gegeuztvzecsikhxcvgl/sql/new

create table if not exists public.doctor_discussion_agenda (
  doctor_id              uuid primary key references auth.users(id) on delete cascade,
  items                  jsonb not null default '[]'::jsonb, -- [{question, caseAnchor, caseGroup, reasoning, followUp, n}]
  window_start           timestamptz,
  window_end             timestamptz,
  source_last_record_at  timestamptz,  -- watermark = MAX(analyzed_at) at compute time
  case_count             int not null default 0,
  model                  text,
  prompt_version         text,
  computed_at            timestamptz not null default now()
);

-- Enable RLS (invariant 11)
alter table public.doctor_discussion_agenda enable row level security;

-- Admin-only table: admin routes use service_role to bypass RLS. No doctor-facing policy.
-- Grants: service_role has full control. anon and authenticated have NO access (invariant 11a).
grant all on public.doctor_discussion_agenda to service_role;
