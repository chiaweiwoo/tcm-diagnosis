-- Migration 011: Activity logs table for light web analytics
-- Tracks login events and doctor-facing API calls (organize, analyze).
-- CLI / calibration calls are excluded at the application layer.
-- Apply in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS activity_logs (
  id           bigserial   PRIMARY KEY,
  doctor_email text        NOT NULL,
  event_type   text        NOT NULL,  -- 'login' | 'organize' | 'analyze'
  metadata     jsonb,                 -- user_agent+ip for login; case_type+mode for analyze
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_email   ON activity_logs(doctor_email);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_event   ON activity_logs(event_type, created_at DESC);

COMMENT ON TABLE  activity_logs               IS 'Light analytics — doctor login and usage events. No draft content stored.';
COMMENT ON COLUMN activity_logs.event_type    IS 'login | organize | analyze';
COMMENT ON COLUMN activity_logs.metadata      IS 'login: {user_agent, ip} | organize: {draft_length} | analyze: {case_type, review_mode}';
