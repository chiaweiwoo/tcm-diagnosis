type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: DeepSeekUsage;
};

type DeepSeekCall = {
  content: string;
  usage?: DeepSeekUsage;
  model: string;
};

export type DeepSeekRates = {
  inputCacheHitPer1M: number;
  inputCacheMissPer1M: number;
  outputPer1M: number;
};

export type DeepSeekCostDetail = {
  costUsd: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  rates: DeepSeekRates;
};

type DeepSeekJsonResult<T> = {
  data: T;
  usage?: DeepSeekUsage;
  costUsd: number;
  costDetail: DeepSeekCostDetail;
  model: string;
  repairedJson?: boolean;
};

type DeepSeekErrorDetails = Record<string, unknown>;

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_TIMEOUT_MS = 45_000;
const RATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Fallback rates used when no env overrides and remote fetch unavailable.
// Set AI_RATES_URL in env to pick up price changes without a redeploy.
const HARDCODED_RATES = {
  flash: {
    inputCacheHitPer1M: 0.0028,
    inputCacheMissPer1M: 0.14,
    outputPer1M: 0.28,
  },
  pro: {
    inputCacheHitPer1M: 0.003625,
    inputCacheMissPer1M: 0.435,
    outputPer1M: 0.87,
  },
} as const;

type RateTier = { flash: { inputCacheHitPer1M: number; inputCacheMissPer1M: number; outputPer1M: number }; pro: { inputCacheHitPer1M: number; inputCacheMissPer1M: number; outputPer1M: number } };

let _rateCache: { rates: RateTier; fetchedAt: number } | null = null;
let _isFetching = false;

function getRateOverride(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function applyEnvOverrides(base: RateTier): RateTier {
  return {
    flash: {
      inputCacheHitPer1M: getRateOverride("DEEPSEEK_FLASH_INPUT_CACHE_HIT_PER_1M", base.flash.inputCacheHitPer1M),
      inputCacheMissPer1M: getRateOverride("DEEPSEEK_FLASH_INPUT_CACHE_MISS_PER_1M", base.flash.inputCacheMissPer1M),
      outputPer1M: getRateOverride("DEEPSEEK_FLASH_OUTPUT_PER_1M", base.flash.outputPer1M),
    },
    pro: {
      inputCacheHitPer1M: getRateOverride("DEEPSEEK_PRO_INPUT_CACHE_HIT_PER_1M", base.pro.inputCacheHitPer1M),
      inputCacheMissPer1M: getRateOverride("DEEPSEEK_PRO_INPUT_CACHE_MISS_PER_1M", base.pro.inputCacheMissPer1M),
      outputPer1M: getRateOverride("DEEPSEEK_PRO_OUTPUT_PER_1M", base.pro.outputPer1M),
    },
  };
}

// Fire-and-forget: fetch remote rates once per 24h, update cache in background.
// Does not block the caller — always returns synchronously from cached/env values.
// AI_RATES_URL JSON shape: { deepseek: { flash: {...}, pro: {...} }, anthropic: { ... } }
// Only the deepseek section is consumed here; anthropic rates are used by CLI scripts.
function triggerRateFetch() {
  const url = process.env.AI_RATES_URL;
  if (!url || _isFetching) return;

  _isFetching = true;
  fetch(url, { signal: AbortSignal.timeout(5_000) })
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
    .then((data) => {
      const deepseek = data && typeof data === "object" && "deepseek" in data
        ? (data as Record<string, unknown>).deepseek as RateTier
        : (data && typeof data === "object" && "flash" in data ? data as RateTier : null);
      if (deepseek && "flash" in deepseek && "pro" in deepseek) {
        _rateCache = { rates: applyEnvOverrides(deepseek), fetchedAt: Date.now() };
      }
    })
    .catch(() => undefined)
    .finally(() => { _isFetching = false; });
}

function getModelRates(): RateTier {
  const now = Date.now();
  const isStale = !_rateCache || now - _rateCache.fetchedAt > RATE_CACHE_TTL_MS;

  if (isStale) {
    triggerRateFetch();
  }

  // Use remote-fetched rates if available; fall back to env overrides on hardcoded base.
  return _rateCache?.rates ?? applyEnvOverrides(HARDCODED_RATES);
}

export class DeepSeekError extends Error {
  status: number;
  details?: DeepSeekErrorDetails;

  constructor(message: string, status = 500, details?: DeepSeekErrorDetails) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
    this.details = details;
  }
}

export function getDeepSeekModel() {
  return process.env.DEEPSEEK_MODEL_DEEP || "deepseek-v4-pro";
}

export function getDeepSeekAnalyzeModel() {
  return process.env.DEEPSEEK_MODEL_ANALYZE || process.env.DEEPSEEK_MODEL_FAST || "deepseek-v4-flash";
}

export function getDeepSeekSmartModel() {
  return process.env.DEEPSEEK_MODEL_DEEP || "deepseek-v4-pro";
}

export function getDeepSeekFastModel() {
  return process.env.DEEPSEEK_MODEL_FAST || "deepseek-v4-flash";
}

function getPricingTier(model?: string) {
  if (!model) return "pro" as const;

  const normalized = model.toLowerCase();
  if (normalized.includes("flash") || normalized === "deepseek-chat" || normalized === "deepseek-reasoner") {
    return "flash" as const;
  }

  return "pro" as const;
}

export function estimateDeepSeekCost(usage?: DeepSeekUsage, model?: string): number {
  return estimateDeepSeekCostDetail(usage, model).costUsd;
}

export function estimateDeepSeekCostDetail(usage?: DeepSeekUsage, model?: string): DeepSeekCostDetail {
  const rates = getModelRates()[getPricingTier(model)];
  const promptTokens = usage?.prompt_tokens ?? 0;
  const cacheHitTokens = usage?.prompt_cache_hit_tokens ?? 0;
  const cacheMissTokens = usage?.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHitTokens);
  const output = usage?.completion_tokens ?? 0;

  const costUsd = Number(
    (
      (cacheHitTokens / 1_000_000) * rates.inputCacheHitPer1M +
      (cacheMissTokens / 1_000_000) * rates.inputCacheMissPer1M +
      (output / 1_000_000) * rates.outputPer1M
    ).toFixed(6),
  );

  return { costUsd, cacheHitTokens, cacheMissTokens, rates };
}

function combineUsage(...usages: Array<DeepSeekUsage | undefined>): DeepSeekUsage | undefined {
  if (!usages.some(Boolean)) return undefined;

  return usages.reduce<DeepSeekUsage>(
    (acc, usage) => ({
      prompt_tokens: (acc.prompt_tokens ?? 0) + (usage?.prompt_tokens ?? 0),
      completion_tokens: (acc.completion_tokens ?? 0) + (usage?.completion_tokens ?? 0),
      total_tokens: (acc.total_tokens ?? 0) + (usage?.total_tokens ?? 0),
      prompt_cache_hit_tokens: (acc.prompt_cache_hit_tokens ?? 0) + (usage?.prompt_cache_hit_tokens ?? 0),
      prompt_cache_miss_tokens: (acc.prompt_cache_miss_tokens ?? 0) + (usage?.prompt_cache_miss_tokens ?? 0),
    }),
    {},
  );
}

function snippet(content: string, limit = 500) {
  return content.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502, {
      parserStage: "extract",
      rawSnippet: snippet(content),
    });
  }

  return candidate.slice(start, end + 1);
}

async function requestDeepSeek({
  messages,
  maxTokens,
  model,
  timeoutMs,
  temperature,
}: {
  messages: DeepSeekMessage[];
  maxTokens: number;
  model: string;
  timeoutMs: number;
  temperature: number;
}): Promise<DeepSeekCall> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new DeepSeekError("服务器尚未配置DEEPSEEK_API_KEY。", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeepSeekError("DeepSeek请求超时，请稍后重试。", 504);
    }

    throw new DeepSeekError("DeepSeek连接失败，请稍后重试。", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new DeepSeekError(`DeepSeek请求失败：${response.status} ${detail.slice(0, 300)}`, response.status);
  }

  const payload = (await response.json()) as DeepSeekResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new DeepSeekError("DeepSeek返回为空，请稍后重试。", 502);
  }

  return { content, usage: payload.usage, model };
}

async function repairJsonContent({
  content,
  model,
  timeoutMs,
  maxTokens,
}: {
  content: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}) {
  return requestDeepSeek({
    model,
    timeoutMs,
    maxTokens,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是JSON格式修复器。只修复JSON语法，不新增医学内容，不补充不存在的信息。若数组或字符串被截断，只保留已经完整可读的项目。只返回合法JSON。",
      },
      {
        role: "user",
        content: `请修复以下JSON，使其可被JSON.parse解析：\n${content}`,
      },
    ],
  });
}

function parseJson<T>(content: string, parserStage: string) {
  try {
    return JSON.parse(extractJsonObject(content)) as T;
  } catch (error) {
    if (error instanceof DeepSeekError) {
      throw new DeepSeekError(error.message, error.status, {
        ...error.details,
        parserStage,
        rawSnippet: snippet(content),
      });
    }

    throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502, {
      parserStage,
      rawSnippet: snippet(content),
    });
  }
}

export async function callDeepSeekJson<T>({
  messages,
  maxTokens = 3000,
  model = getDeepSeekModel(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  repairJson = false,
}: {
  messages: DeepSeekMessage[];
  maxTokens?: number;
  model?: string;
  timeoutMs?: number;
  repairJson?: boolean;
}): Promise<DeepSeekJsonResult<T>> {
  const first = await requestDeepSeek({
    messages,
    maxTokens,
    model,
    timeoutMs,
    temperature: 0.1,
  });

  try {
    const data = parseJson<T>(first.content, "first_parse");
    const costDetail = estimateDeepSeekCostDetail(first.usage, model);
    return { data, usage: first.usage, costUsd: costDetail.costUsd, costDetail, model };
  } catch (error) {
    if (!repairJson) {
      throw error;
    }
  }

  let fastRepair: DeepSeekCall | undefined;

  try {
    fastRepair = await repairJsonContent({
      content: first.content,
      model: getDeepSeekFastModel(),
      timeoutMs: Math.min(timeoutMs, 15_000),
      maxTokens: 900,
    });

    const data = parseJson<T>(fastRepair.content, "fast_repair_parse");
    const usage = combineUsage(first.usage, fastRepair.usage);
    const costDetail = estimateDeepSeekCostDetail(usage, model);
    return { data, usage, costUsd: costDetail.costUsd, costDetail, model, repairedJson: true };
  } catch {
    // Fall through to deep repair.
  }

  try {
    const deepRepair = await repairJsonContent({
      content: fastRepair?.content || first.content,
      model,
      timeoutMs: Math.min(timeoutMs, 20_000),
      maxTokens: 1200,
    });

    const data = parseJson<T>(deepRepair.content, "deep_repair_parse");
    const usage = combineUsage(first.usage, fastRepair?.usage, deepRepair.usage);
    const costDetail = estimateDeepSeekCostDetail(usage, model);
    return { data, usage, costUsd: costDetail.costUsd, costDetail, model, repairedJson: true };
  } catch (error) {
    if (error instanceof DeepSeekError) {
      throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502, {
        ...error.details,
        firstSnippet: snippet(first.content),
        fastRepairSnippet: fastRepair ? snippet(fastRepair.content) : null,
      });
    }

    throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502, {
      parserStage: "deep_repair_parse",
      firstSnippet: snippet(first.content),
      fastRepairSnippet: fastRepair ? snippet(fastRepair.content) : null,
    });
  }
}
