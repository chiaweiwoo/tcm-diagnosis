import { logApiCallUsage, estimateCostFromRates, getDeepSeekProRates, getAssessmentDeepSeekModel } from "./logUsage.mjs";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function requireApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is missing in .env.local");
  return apiKey;
}

const SYSTEM_PROMPT = `你是一位执业超过二十年的中医师，正在内部审核一套中医临床 AI 辅助工具的输出质量。你的任务是评估单个病案从整理到分析的完整流水线输出，判断是否符合真实门诊参考需求。

不要评分博取好感，也不要过度挑剔。只报告你作为临床医生真正在意的问题。

输出格式（每行一项，严格按以下标签，不要添加多余说明）：
整理质量: X/5 — 简短说明
分析深度: X/5 — 简短说明
实用性: X/5 — 简短说明
内部重复: 低/中/高 — 简短说明
情感基调: 适当/过于保守/过于自信 — 简短说明
整体判断: 通过/边缘/不通过
具体问题:
- 问题描述（若无则写"无明显问题"）

评分维度说明：
- 整理质量：字段提取是否准确、建议补充是否有病案针对性而非通用清单
- 分析深度：各栏目是否有实质内容、重点结论是否清晰可用
- 实用性：医生拿到后能否直接参考、无需大量自行补充
- 内部重复：不同栏目是否重复叙述同一内容
- 情感基调：是否过度保守导致无参考价值、或过于自信导致误导
- 整体判断：通过=可直接交付医生；边缘=有明显缺陷但仍可用；不通过=不应展示给医生

若多个维度均为边缘，整体判断为"不通过"。
评分前先通读全部内容再作答。
禁止：虚构内容、堆砌评分、不结合具体内容的空泛评语。
所有输出必须使用简体中文。`;

function buildUserPrompt(example, mode) {
  const modeData = example.modes?.[mode];
  const organize = example.organize ?? {};
  const modeLabel = mode === "normal" ? "常规" : "智能";

  const lines = [];
  lines.push(`病案编号：${example.id}`);
  lines.push(`病案类型推断：${example.caseTypeGuess ?? "未知"}`);
  lines.push(`主题推断：${example.topicGuess ?? "未知"}`);
  lines.push(`草稿预览：${example.draftPreview ?? ""}`);
  lines.push("");
  lines.push("── 整理阶段 ──");
  lines.push(`状态：${organize.status}`);
  if (organize.formSummary?.length) lines.push(`字段摘要：${organize.formSummary.join("、")}`);
  if (organize.notes?.length) lines.push(`整理备注：\n${organize.notes.map((n) => `- ${n}`).join("\n")}`);
  if (organize.suggestions?.length) lines.push(`建议补充：\n${organize.suggestions.map((s) => `- ${s}`).join("\n")}`);

  if (modeData) {
    lines.push("");
    lines.push(`── 分析阶段（${modeLabel}）──`);
    lines.push(`状态：${modeData.status}`);
    if (modeData.status === "blocked" && modeData.blockedReasons?.length) {
      lines.push(`阻断原因：${modeData.blockedReasons.join("、")}`);
    }
    if (modeData.status === "success" && modeData.result) {
      const r = modeData.result;
      if (r.title) lines.push(`标题：${r.title}`);
      if (r.keyPoints?.length) lines.push(`重点结论：\n${r.keyPoints.map((s) => `- ${s}`).join("\n")}`);
      if (r.summary) lines.push(`病案摘要：${r.summary}`);
      if (r.groups?.length) {
        for (const group of r.groups) {
          for (const section of group.sections ?? []) {
            if (section.items?.length) {
              lines.push(`${group.title} — ${section.title}：\n${section.items.map((s) => `- ${s}`).join("\n")}`);
            }
          }
        }
      }
      if (r.cautions?.length) lines.push(`风险与提醒：\n${r.cautions.map((s) => `- ${s}`).join("\n")}`);
      if (r.evidence?.length) lines.push(`证据状态：\n${r.evidence.map((s) => `- ${s}`).join("\n")}`);
    }
  } else {
    lines.push("");
    lines.push(`── 分析阶段（${modeLabel}）──`);
    lines.push("整理阶段失败，未进入分析。");
  }

  return lines.join("\n");
}

async function reviewOneExample(example, mode, apiKey, model) {
  const startedAt = Date.now();
  let success = false;

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(example, mode) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`per-example reviewer ${example.id}: ${response.status} ${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Empty response for example ${example.id}`);

    success = true;
    const rates = getDeepSeekProRates();
    const costUsd = estimateCostFromRates(payload.usage, rates);

    await logApiCallUsage({
      route: "scripts/assess-review",
      callName: "per-example-reviewer",
      model: payload.model ?? model,
      success: true,
      latencyMs: Date.now() - startedAt,
      usage: payload.usage,
      costUsd,
      rates,
      metadata: { exampleId: example.id, mode },
    });

    return { id: example.id, scorecard: content.trim(), model: payload.model ?? model };
  } catch (err) {
    if (!success) {
      await logApiCallUsage({
        route: "scripts/assess-review",
        callName: "per-example-reviewer",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        metadata: { exampleId: example.id, mode, error: err.message },
      });
    }
    console.error(`[perExampleReviewer] ${example.id}: ${err.message}`);
    return { id: example.id, scorecard: null, error: err.message };
  }
}

export async function reviewAllExamples(examples, mode) {
  const apiKey = requireApiKey();
  const model = getAssessmentDeepSeekModel();
  const eligible = examples.filter((ex) => ex.organize?.status === "success");
  console.log(`[perExampleReviewer] reviewing ${eligible.length}/${examples.length} examples (mode=${mode})`);
  return Promise.all(eligible.map((ex) => reviewOneExample(ex, mode, apiKey, model)));
}
