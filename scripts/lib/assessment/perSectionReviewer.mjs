import { logApiCallUsage, estimateCostFromRates, getDeepSeekProRates, getAssessmentDeepSeekModel } from "./logUsage.mjs";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function requireApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is missing in .env.local");
  return apiKey;
}

// Sections to review cross-example consistency for
const SECTIONS = [
  {
    key: "重点结论",
    label: "重点结论",
    extract: (ex, mode) => ex.modes?.[mode]?.result?.["重点结论"] ?? null,
  },
  {
    key: "当前思路",
    label: "当前思路",
    extract: (ex, mode) => {
      const t = ex.modes?.[mode]?.result?.["当前思路"];
      if (!t) return null;
      return [
        ...(t["可取之处"] ?? []).map((s) => `可取：${s}`),
        ...(t["需要复核"] ?? []).map((s) => `复核：${s}`),
      ];
    },
  },
  {
    key: "建议优化",
    label: "建议优化",
    extract: (ex, mode) => ex.modes?.[mode]?.result?.["建议优化"] ?? null,
  },
  {
    key: "随访监测",
    label: "随访监测",
    extract: (ex, mode) => ex.modes?.[mode]?.result?.["随访监测"] ?? null,
  },
  {
    key: "风险与提醒",
    label: "风险与提醒",
    extract: (ex, mode) => ex.modes?.[mode]?.result?.["风险与提醒"] ?? null,
  },
  {
    key: "资料整理",
    label: "资料整理（整理备注与建议补充）",
    extract: (ex, _mode) => [
      ...(ex.organize?.notes ?? []).map((s) => `备注：${s}`),
      ...(ex.organize?.suggestions ?? []).map((s) => `建议：${s}`),
    ],
  },
];

const SYSTEM_PROMPT = `你是一位执业超过二十年的中医师，正在内部审核一套中医临床 AI 辅助工具的稳定性。你收到了同一个输出栏目在多个不同病案中的内容，需要判断该栏目的质量是否一致、是否存在系统性问题。

请从以下四个维度简短作答（每条 1-2 句，直接切入问题，不要铺垫）：

情感漂移: 不同病案间语气/信心是否一致？若存在漂移，举一个最明显的例子。
模板化: 不同病案的内容是否过度相似或照搬套路？若有，指出最典型的模板词句。
深度差异: 不同病案的该栏目深度是否均衡？若某些病案明显浅薄，说明原因。
核心问题: 这个栏目目前最需要改进的一点是什么？用一句话说清楚。

只报告真实存在的问题。若某维度表现良好，直接写"无明显问题"。
禁止空泛夸奖。所有输出必须使用简体中文。`;

function buildUserPrompt(sectionLabel, entries) {
  const lines = [`以下是"${sectionLabel}"栏目在 ${entries.length} 个病案中的输出内容：`, ""];
  for (const { id, items } of entries) {
    lines.push(`【病案 ${id}】`);
    if (!items || items.length === 0) {
      lines.push("（空）");
    } else {
      lines.push(...items.map((s) => `- ${s}`));
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function reviewOneSection(section, examples, mode, apiKey, model) {
  const startedAt = Date.now();
  let success = false;

  // Collect entries for examples where organize succeeded
  const entries = examples
    .filter((ex) => ex.organize?.status === "success")
    .map((ex) => {
      const raw = section.extract(ex, mode);
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return { id: ex.id, items };
    });

  if (entries.length === 0) {
    return { key: section.key, label: section.label, analysis: null, error: "no eligible examples" };
  }

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(section.label, entries) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`per-section reviewer (${section.key}): ${response.status} ${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Empty response for section ${section.key}`);

    success = true;
    const rates = getDeepSeekProRates();
    const costUsd = estimateCostFromRates(payload.usage, rates);

    await logApiCallUsage({
      route: "scripts/assess-review",
      callName: "per-section-reviewer",
      model: payload.model ?? model,
      success: true,
      latencyMs: Date.now() - startedAt,
      usage: payload.usage,
      costUsd,
      rates,
      metadata: { sectionKey: section.key, mode, exampleCount: entries.length },
    });

    return { key: section.key, label: section.label, analysis: content.trim(), model: payload.model ?? model };
  } catch (err) {
    if (!success) {
      await logApiCallUsage({
        route: "scripts/assess-review",
        callName: "per-section-reviewer",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        metadata: { sectionKey: section.key, mode, error: err.message },
      });
    }
    console.error(`[perSectionReviewer] ${section.key}: ${err.message}`);
    return { key: section.key, label: section.label, analysis: null, error: err.message };
  }
}

export async function reviewAllSections(examples, mode) {
  const apiKey = requireApiKey();
  const model = getAssessmentDeepSeekModel();
  console.log(`[perSectionReviewer] reviewing ${SECTIONS.length} sections across ${examples.length} examples (mode=${mode})`);
  return Promise.all(SECTIONS.map((section) => reviewOneSection(section, examples, mode, apiKey, model)));
}
