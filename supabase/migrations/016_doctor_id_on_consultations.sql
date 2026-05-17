-- Sprint 1 — Part A: add doctor_id column and backfill from auth.users
--
-- Run Part A first. After it completes, verify zero NULLs:
--   SELECT COUNT(*) FROM consultations WHERE doctor_id IS NULL;
-- If the count is 0, proceed to Part B.

ALTER TABLE consultations ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES auth.users(id);

UPDATE consultations c
  SET doctor_id = u.id
  FROM auth.users u
  WHERE lower(c.doctor_email) = lower(u.email)
    AND c.doctor_id IS NULL;

-- ============================================================
-- Sprint 1 — Part B: enforce NOT NULL and add index
-- Only run after verifying zero NULLs above.
-- ============================================================

ALTER TABLE consultations ALTER COLUMN doctor_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS consultations_doctor_id_idx ON consultations(doctor_id);
