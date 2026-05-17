-- Sprint 4: Analytics tables
-- Four separate tables for two-layer analytics architecture (see AGENTS.md).

-- ---------------------------------------------------------------------------
-- Global prompt-quality layer (manager/admin only)
-- No RLS policies = service_role access only.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_prompt_quality_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start         TIMESTAMPTZ NOT NULL,
  window_end           TIMESTAMPTZ NOT NULL,
  stats                JSONB NOT NULL,
  narrative            TEXT,
  narrative_model      TEXT,
  narrative_tokens_in  INT,
  narrative_tokens_out INT,
  narrative_cost_usd   NUMERIC(10,6),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end)
);
ALTER TABLE analytics_prompt_quality_runs ENABLE ROW LEVEL SECURITY;
-- No SELECT policy: authenticated users cannot read this table directly.
-- Admin routes use service_role which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Per-doctor usage layer (doctor-growth)
-- Doctors can read their own rows; admin uses service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_usage_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start         TIMESTAMPTZ NOT NULL,
  window_end           TIMESTAMPTZ NOT NULL,
  stats                JSONB NOT NULL,
  narrative            TEXT,
  narrative_model      TEXT,
  narrative_tokens_in  INT,
  narrative_tokens_out INT,
  narrative_cost_usd   NUMERIC(10,6),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, window_start, window_end)
);
CREATE INDEX analytics_usage_doctor_idx ON analytics_usage_runs(doctor_id, window_end DESC);
ALTER TABLE analytics_usage_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_self_select ON analytics_usage_runs
  FOR SELECT TO authenticated USING (doctor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Per-doctor performance layer (doctor-growth)
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_performance_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start         TIMESTAMPTZ NOT NULL,
  window_end           TIMESTAMPTZ NOT NULL,
  stats                JSONB NOT NULL,
  narrative            TEXT,
  narrative_model      TEXT,
  narrative_tokens_in  INT,
  narrative_tokens_out INT,
  narrative_cost_usd   NUMERIC(10,6),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, window_start, window_end)
);
CREATE INDEX analytics_performance_doctor_idx ON analytics_performance_runs(doctor_id, window_end DESC);
ALTER TABLE analytics_performance_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_self_select ON analytics_performance_runs
  FOR SELECT TO authenticated USING (doctor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Admin alerts (manager-only)
-- No policies = service_role only. Doctors must never see this table.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_admin_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type       TEXT NOT NULL,
  severity         TEXT NOT NULL,
  payload          JSONB NOT NULL,
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by  UUID REFERENCES auth.users(id),
  acknowledged_at  TIMESTAMPTZ
);
CREATE INDEX analytics_admin_alerts_doctor_idx ON analytics_admin_alerts(doctor_id, triggered_at DESC);
ALTER TABLE analytics_admin_alerts ENABLE ROW LEVEL SECURITY;
-- No SELECT policy.
