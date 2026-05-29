-- Migration 032: on-demand cache for doctor profile snapshots
-- Run in Supabase SQL Editor.

create table public.doctor_profile_snapshots (
  doctor_id             uuid        primary key references auth.users(id) on delete cascade,
  snapshot              jsonb       not null,
  flagged               jsonb       not null default '[]'::jsonb,
  clusters              jsonb       not null default '[]'::jsonb,
  source_last_record_at timestamptz,
  computed_at           timestamptz not null default now()
);

alter table public.doctor_profile_snapshots enable row level security;

-- Admin access only via service_role (no authenticated/anon grants)
grant select, insert, update, delete on public.doctor_profile_snapshots to service_role;
