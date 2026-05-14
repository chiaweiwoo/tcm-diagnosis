-- Add per-call token detail and rate columns to api_call_logs
ALTER TABLE api_call_logs
  ADD COLUMN IF NOT EXISTS call_name text,
  ADD COLUMN IF NOT EXISTS input_cache_hit_tokens integer,
  ADD COLUMN IF NOT EXISTS input_cache_miss_tokens integer,
  ADD COLUMN IF NOT EXISTS input_rate_per_1m numeric(12,6),
  ADD COLUMN IF NOT EXISTS output_rate_per_1m numeric(12,6),
  ADD COLUMN IF NOT EXISTS cache_hit_rate_per_1m numeric(12,6);

COMMENT ON COLUMN api_call_logs.call_name IS 'Logical call name: organize, analyze-normal, analyze-smart, assess-backend-reviewer, etc.';
COMMENT ON COLUMN api_call_logs.input_cache_hit_tokens IS 'DeepSeek prompt_cache_hit_tokens';
COMMENT ON COLUMN api_call_logs.input_cache_miss_tokens IS 'DeepSeek prompt_cache_miss_tokens';
COMMENT ON COLUMN api_call_logs.input_rate_per_1m IS 'Cache-miss input rate per 1M tokens at time of call (USD)';
COMMENT ON COLUMN api_call_logs.output_rate_per_1m IS 'Output rate per 1M tokens at time of call (USD)';
COMMENT ON COLUMN api_call_logs.cache_hit_rate_per_1m IS 'Cache-hit input rate per 1M tokens at time of call (USD)';
