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

drop policy if exists "service role can manage api call logs" on public.api_call_logs;

create policy "service role can manage api call logs"
on public.api_call_logs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
