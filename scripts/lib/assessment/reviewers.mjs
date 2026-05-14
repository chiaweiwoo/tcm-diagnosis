import { logApiCallUsage, estimateCostFromRates, getDeepSeekProRates } from "./logUsage.mjs";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function requireApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is missing in .env.local");
  }
  return apiKey;
}

function getReviewerModel() {
  return process.env.DEEPSEEK_MODEL_DEEP || process.env.DEEPSEEK_MODEL_ANALYZE || "deepseek-v4-pro";
}

function buildReviewerSystemPrompt() {
  return [
    "你是中医临床复核工作台的内部评估员。",
    "你的任务不是给患者建议，而是评估系统输出是否适合医生使用。",
    "请同时从初级中医师、资深中医师、学术研究者三个视角给出结论。",
    "请保持专业、具体、可执行，不要空泛夸奖。",
    "请直接输出 Markdown，不要使用代码块。",
  ].join("");
}

function buildReviewerUserPrompt(summary) {
  return [
    "请根据以下本地后端评估结果，输出一份简洁但有行动性的 Markdown 评语。",
    "必须包含以下小节：",
    "1. 执行摘要",
    "2. 智能 vs 常规",
    "3. 初级中医师视角",
    "4. 资深中医师视角",
    "5. 学术研究者视角",
    "6. 提示词改进建议",
    "7. 优先行动项（分 urgent / medium / good to have）",
    "",
    "评估重点：",
    "- 质量门槛是否合理，是否拦截过严或过松；",
    "- 资料整理与临床复核输出是否稳定、实用、支持性足够；",
    "- 智能与常规是否都值得保留；",
    "- organize / analyze 提示词和拒绝标准还可如何改进；",
    "- 请明确指出看起来不稳定、可能误导、或仍显重复的地方。",
    "",
    "评估资料如下：",
    JSON.stringify(summary, null, 2),
  ].join("\n");
}

export async function reviewBackendAssessment(summary) {
  const apiKey = requireApiKey();
  const model = getReviewerModel();
  const startedAt = Date.now();
  let success = false;

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2200,
        messages: [
          { role: "system", content: buildReviewerSystemPrompt() },
          { role: "user", content: buildReviewerUserPrompt(summary) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Backend reviewer failed: ${response.status} ${detail.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`Backend reviewer returned empty content. Payload: ${JSON.stringify(payload).slice(0, 800)}`);
    }

    success = true;
    const rates = await getDeepSeekProRates();
    const costUsd = estimateCostFromRates(payload.usage, rates);
    const result = { model: payload.model ?? model, usage: payload.usage ?? null, text: content.trim() };

    await logApiCallUsage({
      route: "scripts/assess-backend",
      callName: "assess-backend-reviewer",
      model: result.model,
      success: true,
      latencyMs: Date.now() - startedAt,
      usage: payload.usage,
      costUsd,
      rates,
      metadata: { exampleCount: summary?.exampleCount },
    });

    return result;
  } catch (err) {
    if (!success) {
      await logApiCallUsage({
        route: "scripts/assess-backend",
        callName: "assess-backend-reviewer",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        metadata: { error: err.message },
      });
    }
    throw err;
  }
}
