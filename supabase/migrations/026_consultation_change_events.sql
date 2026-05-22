create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists public.consultation_change_events (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid references public.consultations(id) on delete set null,
  doctor_id uuid not null references auth.users(id) on delete cascade,
  doctor_email text not null,
  event_type text not null,
  changed_fields text[] not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists consultation_change_events_doctor_created_idx
  on public.consultation_change_events (doctor_id, created_at desc);

create index if not exists consultation_change_events_consultation_created_idx
  on public.consultation_change_events (consultation_id, created_at desc);

comment on table public.consultation_change_events is
  'Append-only audit log for consultation updates, including clinical input and analysis metadata changes.';

comment on column public.consultation_change_events.before_data is
  'Changed consultation fields before the update. Stored only inside Supabase for audit traceability.';

comment on column public.consultation_change_events.after_data is
  'Changed consultation fields after the update. Stored only inside Supabase for audit traceability.';

alter table public.consultation_change_events enable row level security;

revoke insert, update, delete on public.consultation_change_events from anon;
revoke insert, update, delete on public.consultation_change_events from authenticated;

drop policy if exists consultation_change_events_self_select on public.consultation_change_events;
create policy consultation_change_events_self_select on public.consultation_change_events
  for select to authenticated
  using (doctor_id = auth.uid());

create or replace function private.log_consultation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_fields text[] := array[]::text[];
  before_data jsonb := '{}'::jsonb;
  after_data jsonb := '{}'::jsonb;
  event_type text := 'metadata_update';
begin
  if new.form_data is distinct from old.form_data then
    changed_fields := array_append(changed_fields, 'form_data');
    before_data := before_data || jsonb_build_object('form_data', old.form_data);
    after_data := after_data || jsonb_build_object('form_data', new.form_data);
    event_type := 'clinical_input_update';
  end if;

  if new.case_id is distinct from old.case_id then
    changed_fields := array_append(changed_fields, 'case_id');
    before_data := before_data || jsonb_build_object('case_id', old.case_id);
    after_data := after_data || jsonb_build_object('case_id', new.case_id);
    if event_type = 'metadata_update' then
      event_type := 'case_reference_update';
    end if;
  end if;

  if new.related_case_id is distinct from old.related_case_id then
    changed_fields := array_append(changed_fields, 'related_case_id');
    before_data := before_data || jsonb_build_object('related_case_id', old.related_case_id);
    after_data := after_data || jsonb_build_object('related_case_id', new.related_case_id);
    if event_type = 'metadata_update' then
      event_type := 'case_reference_update';
    end if;
  end if;

  if new.ai_feedback is distinct from old.ai_feedback then
    changed_fields := array_append(changed_fields, 'ai_feedback');
    before_data := before_data || jsonb_build_object('ai_feedback', old.ai_feedback);
    after_data := after_data || jsonb_build_object('ai_feedback', new.ai_feedback);
    if event_type = 'metadata_update' then
      event_type := 'feedback_update';
    end if;
  end if;

  if new.analysis_result is distinct from old.analysis_result then
    changed_fields := array_append(changed_fields, 'analysis_result');
    before_data := before_data || jsonb_build_object('analysis_result', old.analysis_result);
    after_data := after_data || jsonb_build_object('analysis_result', new.analysis_result);
    event_type := 'analysis_update';
  end if;

  if new.analysis_raw is distinct from old.analysis_raw then
    changed_fields := array_append(changed_fields, 'analysis_raw');
    before_data := before_data || jsonb_build_object('analysis_raw', old.analysis_raw);
    after_data := after_data || jsonb_build_object('analysis_raw', new.analysis_raw);
    event_type := 'analysis_update';
  end if;

  if new.model_meta is distinct from old.model_meta then
    changed_fields := array_append(changed_fields, 'model_meta');
    before_data := before_data || jsonb_build_object('model_meta', old.model_meta);
    after_data := after_data || jsonb_build_object('model_meta', new.model_meta);
    event_type := 'analysis_update';
  end if;

  if new.analysis_status is distinct from old.analysis_status then
    changed_fields := array_append(changed_fields, 'analysis_status');
    before_data := before_data || jsonb_build_object('analysis_status', old.analysis_status);
    after_data := after_data || jsonb_build_object('analysis_status', new.analysis_status);
    event_type := 'analysis_update';
  end if;

  if new.analyzed_at is distinct from old.analyzed_at then
    changed_fields := array_append(changed_fields, 'analyzed_at');
    before_data := before_data || jsonb_build_object('analyzed_at', old.analyzed_at);
    after_data := after_data || jsonb_build_object('analyzed_at', new.analyzed_at);
    event_type := 'analysis_update';
  end if;

  if array_length(changed_fields, 1) is null then
    return new;
  end if;

  insert into public.consultation_change_events (
    consultation_id,
    doctor_id,
    doctor_email,
    event_type,
    changed_fields,
    before_data,
    after_data
  )
  values (
    new.id,
    new.doctor_id,
    coalesce(new.doctor_email, old.doctor_email, ''),
    event_type,
    changed_fields,
    before_data,
    after_data
  );

  return new;
end;
$$;

drop trigger if exists consultations_audit_changes on public.consultations;
create trigger consultations_audit_changes
after update on public.consultations
for each row
execute function private.log_consultation_change();
