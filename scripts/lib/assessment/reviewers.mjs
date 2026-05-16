import { logApiCallUsage, estimateCostFromRates, getDeepSeekProRates, getAssessmentDeepSeekModel } from "./logUsage.mjs";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function requireApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is missing in .env.local");
  return apiKey;
}

const SYSTEM_PROMPT = `你是一位执业超过二十年的中医师，同时也是这套中医临床 AI 辅助工具的内部评审员。你已经读完了所有病案的逐条评分卡和各输出栏目的横向一致性分析，现在需要写一份综合报告。

报告目的：
1. 让开发者（非中医背景）知道系统现在的状态有多好、哪里最需要改
2. 让开发者能带着这份报告直接跟 AI 讨论如何改提示词，不需要重新解释背景
3. 让专科中医医生能快速读懂系统的问题，用最少时间提供最有针对性的反馈

报告必须包含以下六个部分（用 ## 标题分隔）：

## 执行摘要
2-3 句。系统现状的最简描述：整体质量如何，最突出的一个优点，最突出的一个问题。

## 主要发现
不超过 6 条要点。每条一句话，具体可查。不要通用评语。

## 跨病案规律
哪些问题跨病案反复出现？哪些表现稳定？重点放在系统性规律，而非个别病案的一次性问题。

## 提示词改进方向
写给 AI 协作改提示词时直接使用。每条包含：问题描述 + 建议修改方向。不需要写具体代码，但要写清楚属于哪个提示词的问题，以及问题在哪里出现。（当前流水线仅有 analyze 步骤，所有改进方向应针对 analyze 提示词。）

## 优先行动项
分三级：
- 🔴 urgent：不修会影响医生实际使用
- 🟡 medium：有明显改进空间，值得在下一轮解决
- 🟢 good to have：锦上添花，不影响核心使用

## 医生简报
这一节是写给中医专家看的，用于专家咨询前的快速对齐。语言通俗，不要 AI/技术术语。
说明：这是什么工具（一句话）；目前输出表现如何；最希望专家帮忙确认的 2-3 个具体问题。

写完后检查：每条主要发现是否有具体病案或栏目支撑，若没有则删除。
报告语言：简体中文。直接输出 Markdown，不要代码块。不要编造数据或捏造未出现的问题。`;

function buildUserPrompt(aggregate, exampleReviews, sectionReviews) {
  const mode = aggregate.mode ?? Object.keys(aggregate.modeStats ?? {})[0] ?? "normal";
  const modeLabel = mode === "normal" ? "常规" : "智能";
  const stats = aggregate.modeStats?.[mode] ?? {};

  const lines = [];

  // Aggregate stats
  lines.push("## 运行统计");
  lines.push(`运行模式：${modeLabel}（${mode}）`);
  lines.push(`样本总数：${aggregate.exampleCount}`);
  if (aggregate.organizeStats) {
    const o = aggregate.organizeStats;
    lines.push(`整理成功：${o.success}/${o.total}，失败：${o.failed}`);
  }
  if (stats.count) {
    lines.push(`分析成功：${stats.success}/${stats.count}，阻断：${stats.blocked}，失败：${stats.failed}，JSON修复：${stats.repairTriggered}`);
    lines.push(`均延迟：${stats.averageLatencyMs} ms，均费用：US$${stats.averageCostUsd}`);
  }
  if (aggregate.blockedReasonGroups && Object.keys(aggregate.blockedReasonGroups).length) {
    lines.push("阻断原因：" + Object.entries(aggregate.blockedReasonGroups).map(([k, v]) => `${k}×${v}`).join("、"));
  }
  lines.push("");

  // Per-example scorecards
  if (exampleReviews?.length) {
    lines.push("## 逐条病案评分卡");
    for (const rev of exampleReviews) {
      lines.push(`### 病案 ${rev.id}`);
      if (rev.scorecard) {
        lines.push(rev.scorecard);
      } else {
        lines.push(`评审失败：${rev.error ?? "未知错误"}`);
      }
      lines.push("");
    }
  }

  // Per-section consistency analyses
  if (sectionReviews?.length) {
    lines.push("## 各输出栏目一致性分析");
    for (const sec of sectionReviews) {
      lines.push(`### ${sec.label}`);
      if (sec.analysis) {
        lines.push(sec.analysis);
      } else {
        lines.push(`分析失败：${sec.error ?? "未知错误"}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("请根据以上所有材料，写出完整的综合报告。");

  return lines.join("\n");
}

export async function reviewBackendAssessment(aggregate, exampleReviews, sectionReviews) {
  const apiKey = requireApiKey();
  const model = getAssessmentDeepSeekModel();
  const startedAt = Date.now();
  let success = false;

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 3000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(aggregate, exampleReviews, sectionReviews) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`final reviewer failed: ${response.status} ${detail.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Final reviewer returned empty content. Payload: ${JSON.stringify(payload).slice(0, 800)}`);

    success = true;
    const rates = getDeepSeekProRates();
    const costUsd = estimateCostFromRates(payload.usage, rates);
    const result = { model: payload.model ?? model, usage: payload.usage ?? null, text: content.trim() };

    await logApiCallUsage({
      route: "scripts/assess-review",
      callName: "final-synthesis-reviewer",
      model: result.model,
      success: true,
      latencyMs: Date.now() - startedAt,
      usage: payload.usage,
      costUsd,
      rates,
      metadata: { exampleCount: aggregate?.exampleCount, exampleReviewCount: exampleReviews?.length, sectionReviewCount: sectionReviews?.length },
    });

    return result;
  } catch (err) {
    if (!success) {
      await logApiCallUsage({
        route: "scripts/assess-review",
        callName: "final-synthesis-reviewer",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        metadata: { error: err.message },
      });
    }
    throw err;
  }
}
