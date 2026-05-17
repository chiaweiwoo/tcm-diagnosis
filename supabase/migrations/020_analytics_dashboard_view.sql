-- Sprint 4: Analytics doctor dashboard view
-- Joins usage and performance runs for a given doctor + window.
-- security_invoker = on: RLS on underlying tables is evaluated as the calling user,
-- so doctors can only see their own rows through this view.

CREATE VIEW analytics_doctor_dashboard
WITH (security_invoker = on)
AS
SELECT
  u.id            AS usage_run_id,
  u.doctor_id,
  u.window_start,
  u.window_end,
  u.stats         AS usage_stats,
  u.narrative     AS usage_narrative,
  p.stats         AS performance_stats,
  p.narrative     AS performance_narrative,
  u.created_at
FROM analytics_usage_runs u
LEFT JOIN analytics_performance_runs p
       ON p.doctor_id    = u.doctor_id
      AND p.window_start = u.window_start
      AND p.window_end   = u.window_end;
