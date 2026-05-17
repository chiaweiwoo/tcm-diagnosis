-- Sprint 1 — Enable Row Level Security on consultations.
-- Run AFTER migration 016 (doctor_id NOT NULL must exist first).
--
-- Service-role key bypasses RLS — admin routes remain unaffected.
-- Authenticated sessions are restricted to their own rows only.

ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY consultations_self_select ON consultations
  FOR SELECT TO authenticated
  USING (doctor_id = auth.uid());

CREATE POLICY consultations_self_insert ON consultations
  FOR INSERT TO authenticated
  WITH CHECK (doctor_id = auth.uid());

CREATE POLICY consultations_self_update ON consultations
  FOR UPDATE TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

CREATE POLICY consultations_self_delete ON consultations
  FOR DELETE TO authenticated
  USING (doctor_id = auth.uid());
