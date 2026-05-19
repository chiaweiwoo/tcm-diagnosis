-- Migration 022: make doctor evaluations append-only.
-- Goal 2 evaluations are historical run records; repeated runs for the same
-- doctor/window should insert new rows rather than overwrite earlier output.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analytics_doctor_evaluations_doctor_id_window_start_window_end_key'
  ) THEN
    ALTER TABLE public.analytics_doctor_evaluations
      DROP CONSTRAINT analytics_doctor_evaluations_doctor_id_window_start_window_end_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS analytics_doctor_evaluations_doctor_created_idx
  ON public.analytics_doctor_evaluations (doctor_id, created_at DESC);
