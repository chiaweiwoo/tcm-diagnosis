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

// Hardcoded fallback rates — override via DEEPSEEK_RATES_URL or individual env vars.
// DEEPSEEK_RATES_URL should point to a JSON of { flash: {...}, pro: {...} } with the
// same key names. Fetched once per CLI process run.
const HARDCODED_RATES = {
  flash: { inputCacheHitPer1M: 0.0028, inputCacheMissPer1M: 0.14, outputPer1M: 0.28 },
  pro: { inputCacheHitPer1M: 0.003625, inputCacheMissPer1M: 0.435, outputPer1M: 0.87 },
};

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

let _remoteRates = null;
let _remoteRatesFetched = false;

async function fetchRemoteRates() {
  if (_remoteRatesFetched) return;
  _remoteRatesFetched = true;

  const url = process.env.DEEPSEEK_RATES_URL;
  if (!url) return;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.flash && data?.pro) {
      _remoteRates = data;
      console.log("[logUsage] loaded remote DeepSeek rates from", url);
    }
  } catch {
    // fall back to env / hardcoded
  }
}

function resolvedRates(tier) {
  const base = _remoteRates?.[tier] ?? HARDCODED_RATES[tier];
  return {
    inputCacheHitPer1M: envNum(`DEEPSEEK_${tier.toUpperCase()}_INPUT_CACHE_HIT_PER_1M`, base.inputCacheHitPer1M),
    inputCacheMissPer1M: envNum(`DEEPSEEK_${tier.toUpperCase()}_INPUT_CACHE_MISS_PER_1M`, base.inputCacheMissPer1M),
    outputPer1M: envNum(`DEEPSEEK_${tier.toUpperCase()}_OUTPUT_PER_1M`, base.outputPer1M),
  };
}

export async function getDeepSeekProRates() {
  await fetchRemoteRates();
  return resolvedRates("pro");
}

export async function getDeepSeekFlashRates() {
  await fetchRemoteRates();
  return resolvedRates("flash");
}

// Anthropic rates (approximate — no public JSON endpoint, update manually)
export function getAnthropicSonnetRates() {
  return {
    inputCacheHitPer1M: 0.3,
    inputCacheMissPer1M: 3.0,
    outputPer1M: 15.0,
  };
}
