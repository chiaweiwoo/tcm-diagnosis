import { logApiCallUsage, estimateCostFromRates, getDeepSeekProRates, getAnthropicSonnetRates } from "./logUsage.mjs";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function requireDeepSeekKey() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing in .env.local");
  return key;
}

function requireAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is missing in .env.local");
  return key;
}

function getDeepSeekModel() {
  return process.env.DEEPSEEK_MODEL_DEEP || process.env.DEEPSEEK_MODEL_ANALYZE || "deepseek-v4-pro";
}

function getAnthropicModel() {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

async function callDeepSeek(systemPrompt, userContent, maxTokens = 2000, callName = "assess-frontend-reviewer") {
  const model = getDeepSeekModel();
  const startedAt = Date.now();

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireDeepSeekKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    await logApiCallUsage({ route: "scripts/report-frontend", callName, model, success: false, latencyMs: Date.now() - startedAt });
    throw new Error(`DeepSeek call failed: ${response.status} ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    await logApiCallUsage({ route: "scripts/report-frontend", callName, model, success: false, latencyMs: Date.now() - startedAt });
    throw new Error("DeepSeek returned empty content");
  }

  const rates = await getDeepSeekProRates();
  const costUsd = estimateCostFromRates(payload.usage, rates);
  await logApiCallUsage({
    route: "scripts/report-frontend",
    callName,
    model: payload.model ?? model,
    success: true,
    latencyMs: Date.now() - startedAt,
    usage: payload.usage,
    costUsd,
    rates,
  });

  return {
    model: payload.model ?? model,
    usage: payload.usage ?? null,
    text: content.trim(),
  };
}

// ── Reviewer 1: UX/product flow (DeepSeek, text-based) ───────────────────────

export async function reviewFrontendUX(observations) {
  const system = [
    "你是一位专注于医疗行业 SaaS 产品的 UX 设计师和业务分析师。",
    "你的任务是根据自动化测试采集到的结构化流程观测数据，评估工作台的可用性。",
    "请仅基于提供的观测数据作出评论，不要臆测未观测到的行为。",
    "请用中文输出，格式为 Markdown，不要使用代码块包裹。",
  ].join("");

  const user = [
    "请根据以下前端自动化评估的流程观测数据，输出一份简洁但有行动性的 UX 分析报告。",
    "",
    "必须包含以下小节：",
    "1. 整体流程评估（流畅度、进度可见性、阻断反馈质量）",
    "2. 成功路径体验（组织→分析流程是否清晰）",
    "3. 阻断状态体验（提示是否清楚、是否给出下一步引导）",
    "4. 历史记录加载体验（重新打开记录后是否稳定）",
    "5. 待改进项（具体、可执行，按优先级排列）",
    "",
    "观测数据如下：",
    JSON.stringify(observations, null, 2),
  ].join("\n");

  return callDeepSeek(system, user, 2000, "assess-frontend-ux");
}

// ── Reviewer 2: Senior TCM practitioner (DeepSeek, text-based) ───────────────

export async function reviewFrontendTCM(observations) {
  const system = [
    "你是一位有二十年临床经验的资深中医师，同时也对数字化诊疗工具有兴趣。",
    "你的任务是根据自动化测试采集到的结构化观测数据，从中医临床视角评估该工作台的输出质量。",
    "仅根据提供的可见文本内容和流程状态作出评论。",
    "请用中文输出，格式为 Markdown，不要使用代码块包裹。",
  ].join("");

  // Extract section text from successful scenarios for clinical review
  const successfulScenarios = observations.scenarios.filter(
    (s) => s.status === "success" && s.sectionText && Object.keys(s.sectionText).length > 0,
  );
  const blockedScenarios = observations.scenarios.filter((s) => s.blockedState);

  const clinicalData = {
    successfulOutputSamples: successfulScenarios.map((s) => ({
      scenario: s.name,
      exampleId: s.exampleId,
      sectionsVisible: s.sectionsVisible,
      sectionText: s.sectionText,
      elapsedMs: s.elapsedMs,
    })),
    blockedGuidance: blockedScenarios.map((s) => ({
      scenario: s.name,
      blockedReason: s.blockedReason,
    })),
  };

  const user = [
    "请从资深中医临床医师的角度，评估以下自动采集的工作台输出样本。",
    "",
    "必须包含以下小节：",
    "1. 临床输出质量（重点结论是否切中要点，还是流于形式？）",
    "2. 输出结构与临床阅读顺序（各板块排列是否符合医师实际查阅习惯？）",
    "3. 阻断提示的临床合理性（被拦截时的提示语是否公正、有帮助？）",
    "4. 整体可信度与实用性（这个工具是否值得在门诊中实际使用？）",
    "5. 临床内容改进建议（具体指出哪些输出让你感到不放心或需要调整）",
    "",
    "临床输出样本如下：",
    JSON.stringify(clinicalData, null, 2),
  ].join("\n");

  return callDeepSeek(system, user, 2200, "assess-frontend-tcm");
}

// ── Reviewer 3: Visual reviewer (Claude, screenshot URLs from storage) ────────

// imageUrls: array of public https:// URLs
export async function reviewFrontendVisual(imageUrls) {
  const apiKey = requireAnthropicKey();
  const model = getAnthropicModel();
  const startedAt = Date.now();

  const validUrls = (imageUrls ?? []).filter((u) => u && u.startsWith("http")).slice(0, 6);

  if (validUrls.length === 0) {
    return { model, usage: null, text: "（无截图可供分析）", skipped: true };
  }


  const imageContent = validUrls.map((url) => ({
    type: "image",
    source: { type: "url", url },
  }));

  const promptText = {
    type: "text",
    text: [
      "以下是中医临床复核工作台在自动化评估运行中采集的截图序列。",
      "这是一款面向中医师的辅助诊疗 SaaS 工具，帮助医师整理病案资料并提供临床参考建议。",
      "",
      "请从以下两个视角，对截图中可见的界面和内容进行评估：",
      "",
      "【产品设计师视角】",
      "- 界面布局是否清晰，信息层级是否合理？",
      "- 加载/进度状态是否可见且友好？",
      "- 中文字体与排版是否易读？",
      "- 操作流程是否自然，有无视觉上的困惑点？",
      "",
      "【资深中医师视角】",
      "- 界面呈现的临床内容是否专业、可信？",
      "- 输出的文字能否在门诊中实际参考使用？",
      "- 对医师的提示和引导是否支持性、而非评判性？",
      "- 整体视觉风格是否适合医疗场景？",
      "",
      "请用中文输出，格式为 Markdown，分两个小节（产品设计师视角 / 资深中医师视角），",
      "每节内给出：1. 做得好的地方 2. 需要改进的地方 3. 具体建议",
      "",
      "仅评论截图中可见的内容，不要臆测未显示的功能。",
    ].join("\n"),
  };

  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: [promptText, ...imageContent],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    await logApiCallUsage({
      route: "scripts/report-frontend",
      callName: "assess-frontend-visual",
      provider: "anthropic",
      model,
      success: false,
      latencyMs: Date.now() - startedAt,
      metadata: { imageCount: validUrls.length },
    });
    throw new Error(`Claude visual review failed: ${response.status} ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = payload.content?.[0]?.text;
  if (!content) throw new Error("Claude returned empty content");

  const rates = getAnthropicSonnetRates();
  const anthropicUsage = payload.usage
    ? {
        prompt_tokens: payload.usage.input_tokens,
        completion_tokens: payload.usage.output_tokens,
        total_tokens: (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0),
      }
    : null;
  const costUsd = anthropicUsage ? estimateCostFromRates(anthropicUsage, rates) : 0;

  await logApiCallUsage({
    route: "scripts/report-frontend",
    callName: "assess-frontend-visual",
    provider: "anthropic",
    model: payload.model ?? model,
    success: true,
    latencyMs: Date.now() - startedAt,
    usage: anthropicUsage,
    costUsd,
    rates,
    metadata: { imageCount: validUrls.length },
  });

  return {
    model: payload.model ?? model,
    usage: payload.usage ?? null,
    text: content.trim(),
  };
}
