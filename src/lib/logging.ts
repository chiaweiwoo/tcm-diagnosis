type ErrorLogInput = {
  source: string;
  message: string;
  level?: "error" | "warn" | "info";
  details?: Record<string, unknown>;
};

type ApiCallLogInput = {
  route: string;
  callName?: string;
  provider?: "deepseek" | "anthropic";
  success: boolean;
  model?: string;
  latencyMs?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  costUsd?: number;
  ratesSnapshot?: {
    inputCacheHitPer1M: number;
    inputCacheMissPer1M: number;
    outputPer1M: number;
  };
  promptVersion?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export async function logServerEvent(input: ErrorLogInput) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(`[${input.source}] ${input.message}`, input.details ?? {});
    return;
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/error_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source: input.source,
        level: input.level ?? "error",
        message: input.message,
        details: input.details ?? null,
      }),
    });
  } catch (error) {
    console.error("[logging] failed to write error log", error);
  }
}

export async function logApiCall(input: ApiCallLogInput) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.info(`[${input.route}] api call`, input);
    return;
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/api_call_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        route: input.route,
        call_name: input.callName ?? null,
        provider: input.provider ?? "deepseek",
        model: input.model ?? null,
        success: input.success,
        latency_ms: input.latencyMs ?? null,
        prompt_tokens: input.usage?.prompt_tokens ?? null,
        completion_tokens: input.usage?.completion_tokens ?? null,
        total_tokens: input.usage?.total_tokens ?? null,
        input_cache_hit_tokens: input.usage?.prompt_cache_hit_tokens ?? null,
        input_cache_miss_tokens: input.usage?.prompt_cache_miss_tokens ?? null,
        cost_usd: input.costUsd ?? null,
        rates_snapshot: input.ratesSnapshot ?? null,
        prompt_version: input.promptVersion ?? null,
        error_message: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      }),
    });
  } catch (error) {
    console.error("[logging] failed to write api call log", error);
  }
}
