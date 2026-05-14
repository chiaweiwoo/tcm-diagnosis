export type ApiCallLogRow = {
  id: string;
  created_at: string;
  route: string;
  call_name: string | null;
  provider: string | null;
  model: string | null;
  success: boolean;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  input_cache_hit_tokens: number | null;
  input_cache_miss_tokens: number | null;
  cost_usd: number | null;
  rates_snapshot: { inputCacheHitPer1M: number; inputCacheMissPer1M: number; outputPer1M: number } | null;
  prompt_version: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
};

export type UsageSummary = {
  totalCalls: number;
  successCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheHitTokens: number;
};

function getConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return {
    baseUrl: `${supabaseUrl}/rest/v1/api_call_logs`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  };
}

export async function listApiCallLogs(limit = 100): Promise<ApiCallLogRow[]> {
  const config = getConfig();
  if (!config) return [];

  const url = new URL(config.baseUrl);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, { headers: config.headers, cache: "no-store" });
  if (!response.ok) return [];
  return (await response.json()) as ApiCallLogRow[];
}

export function computeUsageSummary(rows: ApiCallLogRow[]): UsageSummary {
  return rows.reduce<UsageSummary>(
    (acc, row) => ({
      totalCalls: acc.totalCalls + 1,
      successCalls: acc.successCalls + (row.success ? 1 : 0),
      totalCostUsd: acc.totalCostUsd + (row.cost_usd ?? 0),
      totalInputTokens: acc.totalInputTokens + (row.prompt_tokens ?? 0),
      totalOutputTokens: acc.totalOutputTokens + (row.completion_tokens ?? 0),
      totalCacheHitTokens: acc.totalCacheHitTokens + (row.input_cache_hit_tokens ?? 0),
    }),
    { totalCalls: 0, successCalls: 0, totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0 },
  );
}
