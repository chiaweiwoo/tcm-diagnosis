-- Migration 002: doctor allowlist
-- Adds the doctor_allowlist table with trigger for updated_at.
-- Applied: May 2026

create table if not exists public.doctor_allowlist (
  email text primary key,
  is_active boolean not null default true,
  display_name text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists doctor_allowlist_set_updated_at on public.doctor_allowlist;
create trigger doctor_allowlist_set_updated_at
  before update on public.doctor_allowlist
  for each row execute function public.set_updated_at();

alter table public.doctor_allowlist enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'doctor_allowlist'
    and policyname = 'service role can manage doctor_allowlist'
  ) then
    create policy "service role can manage doctor_allowlist"
      on public.doctor_allowlist for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

insert into public.doctor_allowlist (email, display_name, note)
values
  ('chiaweiwoo123@gmail.com', 'Woo Chia Wei', 'project owner'),
  ('ardytcm@gmail.com', 'Ardy TCM', 'clinic tester')
on conflict (email) do update set
  is_active = excluded.is_active,
  display_name = excluded.display_name,
  note = excluded.note,
  updated_at = now();
