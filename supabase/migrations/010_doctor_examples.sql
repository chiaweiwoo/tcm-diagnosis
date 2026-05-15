-- Migration 010: Doctor examples table
-- Stores real-doctor examples previously kept in local-data/real-doctor-examples.md
-- Apply in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS doctor_examples (
  id              text        PRIMARY KEY,            -- e.g. "real-example-001"
  case_type_guess text        NOT NULL DEFAULT '',    -- e.g. "方药分析"
  topic_guess     text        NOT NULL DEFAULT '',    -- e.g. "失眠处方"
  draft           text        NOT NULL DEFAULT '',    -- full draft text
  is_active       boolean     NOT NULL DEFAULT true,  -- soft-disable without deleting
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  doctor_examples                  IS 'Real doctor examples used for calibration runs. Populated via assess:seed script. Admin read-only in UI.';
COMMENT ON COLUMN doctor_examples.is_active        IS 'Set to false to exclude from calibration runs without deleting the row.';
COMMENT ON COLUMN doctor_examples.case_type_guess  IS 'Inferred case type: 方药分析 | 针灸方案 | 综合调理';
