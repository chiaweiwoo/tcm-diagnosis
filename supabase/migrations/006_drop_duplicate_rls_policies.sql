-- Drop duplicate RLS policies created manually before migrations were introduced.
-- The underscore-named versions from migration 001 are canonical; these are redundant.
do $$ begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'api_call_logs'
      and policyname = 'service role can manage api call logs'
  ) then
    drop policy "service role can manage api call logs" on api_call_logs;
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'error_logs'
      and policyname = 'service role can manage error logs'
  ) then
    drop policy "service role can manage error logs" on error_logs;
  end if;
end $$;
