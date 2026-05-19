-- Migration 022: make doctor evaluations append-only.
-- Goal 2 evaluations are historical run records; repeated runs for the same
-- doctor/window should insert new rows rather than overwrite earlier output.

-- Postgres truncates identifiers to 63 chars; the actual constraint name is
-- the 63-char truncation of the full "…window_start_window_end_key" name.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.analytics_doctor_evaluations'::regclass
    AND contype = 'u'
    AND conname LIKE 'analytics_doctor_evaluations_doctor_id_window_start_window%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.analytics_doctor_evaluations DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS analytics_doctor_evaluations_doctor_created_idx
  ON public.analytics_doctor_evaluations (doctor_id, created_at DESC);
