-- Replace three separate rate columns with a single rates_snapshot JSONB.
-- All three columns were NULL across all existing rows (added in 005 but never
-- populated before deployment), so this is a clean swap with no data loss.
alter table api_call_logs
  drop column if exists input_rate_per_1m,
  drop column if exists output_rate_per_1m,
  drop column if exists cache_hit_rate_per_1m,
  add column rates_snapshot jsonb default null;

comment on column api_call_logs.rates_snapshot is
  'Rate card used to compute cost_usd at call time: {inputCacheHitPer1M, inputCacheMissPer1M, outputPer1M}. Snapshot so cost is auditable even after provider price changes.';
