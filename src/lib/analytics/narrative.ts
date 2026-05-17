/**
 * Analytics narrative generation — Sprint 5.
 *
 * Wraps the three stats types from stats.ts with DeepSeek Flash calls to
 * produce short Chinese narrative strings for display in the admin/doctor UI.
 *
 * Invariant #8: narrative text (the output) must never go to Langfuse.
 * The aggregate stats JSON (input) contains no PII and is safe to log.
 */

import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import {
  USAGE_NARRATIVE_SYSTEM_PROMPT,
  PERFORMANCE_NARRATIVE_SYSTEM_PROMPT,
  PROMPT_QUALITY_NARRATIVE_SYSTEM_PROMPT,
} from "./prompts";
import type { UsageStats, PerformanceStats, PromptQualityStats } from "./stats";

type NarrativeResult = { narrative: string };

// ---------------------------------------------------------------------------
// Usage narrative — doctor-growth, per-doctor
// ---------------------------------------------------------------------------

export async function generateUsageNarrative(
  stats: UsageStats,
  doctorEmail: string,
): Promise<string> {
  const userPrompt = buildUsageUserPrompt(stats, doctorEmail);
  const result = await callDeepSeekJson<NarrativeResult>({
    messages: [
      { role: "system", content: USAGE_NARRATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model: getDeepSeekFastModel(),
    maxTokens: 300,
    repairJson: true,
  });
  return result.data.narrative ?? "";
}

function buildUsageUserPrompt(stats: UsageStats, doctorEmail: string): string {
  const typeDist = Object.entries(stats.prescriptionTypeDist)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}(${c})`)
    .join("、");

  const topDx = stats.topDiagnoses
    .slice(0, 5)
    .map((d) => d.value)
    .join("、");

  const topCC = stats.topComplaints
    .slice(0, 5)
    .map((d) => d.value)
    .join("、");

  return [
    `医生：${doctorEmail}`,
    `本月统计数据（过去30天）：`,
    `- 分析次数：${stats.consultationCount}`,
    `- 有记录日期：${stats.activeDays} 天`,
    `- 平均每活跃日：${stats.avgPerActiveDay}`,
    typeDist ? `- 处方类型分布：${typeDist}` : "",
    topDx ? `- 常见诊断（前5）：${topDx}` : "",
    topCC ? `- 常见主诉关键词（前5）：${topCC}` : "",
    "",
    "请根据以上数据，为医生生成支持性月度使用小结（120字以内）。",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Performance narrative — doctor-growth, per-doctor
// ---------------------------------------------------------------------------

export async function generatePerformanceNarrative(
  stats: PerformanceStats,
  doctorEmail: string,
): Promise<string> {
  const userPrompt = buildPerformanceUserPrompt(stats, doctorEmail);
  const result = await callDeepSeekJson<NarrativeResult>({
    messages: [
      { role: "system", content: PERFORMANCE_NARRATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model: getDeepSeekFastModel(),
    maxTokens: 300,
    repairJson: true,
  });
  return result.data.narrative ?? "";
}

const FIELD_LABELS: Record<string, string> = {
  chiefComplaint: "主诉",
  currentIllness: "现病史",
  physicalExam: "体格检查",
  diagnosis: "诊断",
  pattern: "证型",
  prescription: "处方",
  pastHistory: "既往史",
};

function buildPerformanceUserPrompt(stats: PerformanceStats, doctorEmail: string): string {
  const fieldLines = Object.entries(stats.avgLengthPerField)
    .map(([field, len]) => `  ${FIELD_LABELS[field] ?? field}：平均 ${len} 字`)
    .join("\n");

  const topPairs = stats.topDiagnosisPatternPairs
    .slice(0, 3)
    .map((p) => `${p.diagnosis}×${p.pattern}`)
    .join("、");

  return [
    `医生：${doctorEmail}`,
    `本月病案填写情况（过去30天）：`,
    `各字段平均字数：`,
    fieldLines,
    `- JSON修复率：${(stats.repairedJsonRate * 100).toFixed(0)}%`,
    `- 风险提醒触发率：${(stats.riskFlagRate * 100).toFixed(0)}%`,
    topPairs ? `- 常见诊断-证型组合：${topPairs}` : "",
    "",
    "请根据以上数据，为医生生成支持性病案记录习惯小结（120字以内）。",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Prompt quality narrative — admin/manager layer
// ---------------------------------------------------------------------------

export async function generatePromptQualityNarrative(
  stats: PromptQualityStats,
): Promise<string> {
  const userPrompt = buildQualityUserPrompt(stats);
  const result = await callDeepSeekJson<NarrativeResult>({
    messages: [
      { role: "system", content: PROMPT_QUALITY_NARRATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model: getDeepSeekFastModel(),
    maxTokens: 400,
    repairJson: true,
  });
  return result.data.narrative ?? "";
}

function buildQualityUserPrompt(stats: PromptQualityStats): string {
  const cov = stats.sectionCoverage;
  const coverageLines = [
    `  重点结论：${pct(cov.keyPoints)}`,
    `  风险提醒：${pct(cov.cautions)}`,
    `  证据状态：${pct(cov.evidence)}`,
    `  判断列（column0）：${pct(cov.column0)}`,
    `  方案列（column1）：${pct(cov.column1)}`,
    `  随访列（column2）：${pct(cov.column2)}`,
  ].join("\n");

  const typeDist = Object.entries(stats.prescriptionTypeDist)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}(${c})`)
    .join("、");

  return [
    `本周全局 AI 管道质量数据（过去7天）：`,
    `- 分析次数：${stats.consultationCount}`,
    `- JSON修复率：${pct(stats.repairedJsonRate)}`,
    `- 风险提醒触发率：${pct(stats.riskFlagRate)}`,
    stats.avgDurationSeconds !== null
      ? `- 平均响应时长：${stats.avgDurationSeconds}秒`
      : "",
    typeDist ? `- 处方类型分布：${typeDist}` : "",
    `结构板块覆盖率：`,
    coverageLines,
    "",
    "请生成管理员用的质量小结（150字以内），直接陈述状态，有问题标注建议检查。",
  ]
    .filter(Boolean)
    .join("\n");
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}
