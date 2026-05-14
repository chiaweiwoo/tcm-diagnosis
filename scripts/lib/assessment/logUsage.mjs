import { loadEnv } from "../env.mjs";

loadEnv();

export async function logApiCallUsage({
  route,
  callName,
  provider = "deepseek",
  model,
  success,
  latencyMs,
  usage,
  costUsd,
  rates,
  metadata,
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.info(`[logUsage] ${callName ?? route}`, { costUsd, model });
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
        route,
        call_name: callName ?? null,
        provider,
        model: model ?? null,
        success,
        latency_ms: latencyMs ?? null,
        prompt_tokens: usage?.prompt_tokens ?? null,
        completion_tokens: usage?.completion_tokens ?? null,
        total_tokens: usage?.total_tokens ?? null,
        input_cache_hit_tokens: usage?.prompt_cache_hit_tokens ?? null,
        input_cache_miss_tokens: usage?.prompt_cache_miss_tokens ?? null,
        cost_usd: costUsd ?? null,
        input_rate_per_1m: rates?.inputCacheMissPer1M ?? null,
        output_rate_per_1m: rates?.outputPer1M ?? null,
        cache_hit_rate_per_1m: rates?.inputCacheHitPer1M ?? null,
        metadata: metadata ?? null,
      }),
    });
  } catch (err) {
    console.warn("[logUsage] failed to write api call log:", err.message);
  }
}

// Estimate cost from DeepSeek usage using rates object
export function estimateCostFromRates(usage, rates) {
  if (!usage || !rates) return 0;
  const promptTokens = usage.prompt_tokens ?? 0;
  const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
  const cacheMiss = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
  const output = usage.completion_tokens ?? 0;
  return Number(
    (
      (cacheHit / 1_000_000) * rates.inputCacheHitPer1M +
      (cacheMiss / 1_000_000) * rates.inputCacheMissPer1M +
      (output / 1_000_000) * rates.outputPer1M
    ).toFixed(6),
  );
}

// Default DeepSeek rates (can be overridden by env)
export function getDeepSeekProRates() {
  return {
    inputCacheHitPer1M: Number(process.env.DEEPSEEK_PRO_INPUT_CACHE_HIT_PER_1M ?? 0.003625),
    inputCacheMissPer1M: Number(process.env.DEEPSEEK_PRO_INPUT_CACHE_MISS_PER_1M ?? 0.435),
    outputPer1M: Number(process.env.DEEPSEEK_PRO_OUTPUT_PER_1M ?? 0.87),
  };
}

export function getDeepSeekFlashRates() {
  return {
    inputCacheHitPer1M: Number(process.env.DEEPSEEK_FLASH_INPUT_CACHE_HIT_PER_1M ?? 0.0028),
    inputCacheMissPer1M: Number(process.env.DEEPSEEK_FLASH_INPUT_CACHE_MISS_PER_1M ?? 0.14),
    outputPer1M: Number(process.env.DEEPSEEK_FLASH_OUTPUT_PER_1M ?? 0.28),
  };
}

// Anthropic rates (approximate, not token-level granular)
export function getAnthropicSonnetRates() {
  return {
    inputCacheHitPer1M: 0.3,
    inputCacheMissPer1M: 3.0,
    outputPer1M: 15.0,
  };
}
