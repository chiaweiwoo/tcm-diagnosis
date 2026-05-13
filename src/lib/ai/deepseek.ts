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
  }>;
  usage?: DeepSeekUsage;
};

type DeepSeekCall = {
  content: string;
  usage?: DeepSeekUsage;
  model: string;
};

type DeepSeekJsonResult<T> = {
  data: T;
  usage?: DeepSeekUsage;
  costUsd: number;
  model: string;
  repairedJson?: boolean;
};

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const PRO_INPUT_PER_1M = 0.435;
const PRO_OUTPUT_PER_1M = 0.87;
const DEFAULT_TIMEOUT_MS = 45_000;

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

export function getDeepSeekFastModel() {
  return process.env.DEEPSEEK_MODEL_FAST || "deepseek-v4-flash";
}

export function estimateDeepSeekCost(usage?: DeepSeekUsage) {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;

  return Number(((input / 1_000_000) * PRO_INPUT_PER_1M + (output / 1_000_000) * PRO_OUTPUT_PER_1M).toFixed(6));
}

function combineUsage(first?: DeepSeekUsage, second?: DeepSeekUsage): DeepSeekUsage | undefined {
  if (!first && !second) return undefined;

  return {
    prompt_tokens: (first?.prompt_tokens ?? 0) + (second?.prompt_tokens ?? 0),
    completion_tokens: (first?.completion_tokens ?? 0) + (second?.completion_tokens ?? 0),
    total_tokens: (first?.total_tokens ?? 0) + (second?.total_tokens ?? 0),
  };
}

export function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502);
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
  timeoutMs,
}: {
  content: string;
  timeoutMs: number;
}) {
  return requestDeepSeek({
    model: getDeepSeekFastModel(),
    timeoutMs,
    maxTokens: 800,
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
    temperature: 0.2,
  });

  try {
    const data = JSON.parse(extractJsonObject(first.content)) as T;

    return {
      data,
      usage: first.usage,
      costUsd: estimateDeepSeekCost(first.usage),
      model,
    };
  } catch {
    if (!repairJson) {
      throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502);
    }
  }

  try {
    const repaired = await repairJsonContent({
      content: first.content,
      timeoutMs: Math.min(timeoutMs, 20_000),
    });
    const usage = combineUsage(first.usage, repaired.usage);
    const data = JSON.parse(extractJsonObject(repaired.content)) as T;

    return {
      data,
      usage,
      costUsd: estimateDeepSeekCost(usage),
      model,
      repairedJson: true,
    };
  } catch {
    throw new DeepSeekError("DeepSeek返回的JSON无法解析。", 502);
  }
}
