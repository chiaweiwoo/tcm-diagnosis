type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: DeepSeekUsage;
};

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const PRO_INPUT_PER_1M = 0.435;
const PRO_OUTPUT_PER_1M = 0.87;

export class DeepSeekError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
  }
}

export function getDeepSeekModel() {
  return process.env.DEEPSEEK_MODEL_DEEP || "deepseek-v4-pro";
}

export function estimateDeepSeekCost(usage?: DeepSeekUsage) {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;

  return Number(((input / 1_000_000) * PRO_INPUT_PER_1M + (output / 1_000_000) * PRO_OUTPUT_PER_1M).toFixed(6));
}

export async function callDeepSeekJson<T>({
  messages,
  maxTokens = 3000,
}: {
  messages: DeepSeekMessage[];
  maxTokens?: number;
}): Promise<{ data: T; usage?: DeepSeekUsage; costUsd: number; model: string }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new DeepSeekError("服务器尚未配置DEEPSEEK_API_KEY。", 503);
  }

  const model = getDeepSeekModel();
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new DeepSeekError(`DeepSeek请求失败：${response.status} ${detail.slice(0, 300)}`, response.status);
  }

  const payload = (await response.json()) as DeepSeekResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new DeepSeekError("DeepSeek返回为空，请稍后重试。", 502);
  }

  try {
    const data = JSON.parse(content) as T;
    return {
      data,
      usage: payload.usage,
      costUsd: estimateDeepSeekCost(payload.usage),
      model,
    };
  } catch {
    throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502);
  }
}
