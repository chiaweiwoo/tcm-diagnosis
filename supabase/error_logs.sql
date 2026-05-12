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

drop policy if exists "service role can manage error logs" on public.error_logs;

create policy "service role can manage error logs"
on public.error_logs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
