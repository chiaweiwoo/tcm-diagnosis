/**
 * Fleet-wide AI output audit — Goal 1 (v3).
 *
 * Audits AI output quality across all doctors over a rolling window anchored
 * to the fleet's most recent analyzed_at timestamp.
 * On-demand only. Stored in analytics_output_audits. Never shown to doctors.
 *
 * v3: window anchored to MAX(analyzed_at) fleet-wide; newest-first cap-100
 * sampling; doctor feedback corpus (cap 50, anonymised); consistency groups;
 * no prior-audit chaining.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { buildOutputAuditSystemPrompt, OUTPUT_AUDIT_PROMPT_VERSION } from "./prompts";
import { TCM_ANALYSIS_PROMPT_VERSION } from "@/lib/ai/prompts";
import { buildWindowFromLatestAnalysis } from "./stats";
import { serializeConsultationsCompact } from "./evaluation";
import { getLangfuse } from "@/lib/langfuse";
import { CATEGORY_ORDER } from "./auditDefinitions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Finding = {
  findingKey: string;
  shortName: string;
  observation: string;
  severity: "high" | "medium" | "low";
  exampleCases: { summary: string }[];
  suggestedFix?: string;
};

export type AuditCategories = {
  hallucination: Finding[];
  reliability: Finding[];
  safety: Finding[];
  completeness: Finding[];
  tone: Finding[];
  structure: Finding[];
  consistency: Finding[];
};

export type PromptImprovement = {
  issue: string;
  suggestedPromptChange: string;
};

export type OutputAuditResult = {
  verdict: "stable" | "needs_attention" | "regressing";
  reviewSummary: string;
  categories: AuditCategories;
  promptImprovements: PromptImprovement[];
  userFeedbackSummary: string | null;
};

export type OutputAuditRow = {
  id: string;
  created_at: string;
  window_start: string;
  window_end: string;
  prior_review_id: string | null;
  prompt_version_at_run: string;
  sample_size: number;
  model: string;
  review: OutputAuditResult;
};

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

type CaseRow = {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
};

type FeedbackRow = {
  ai_feedback: string;
};

// ---------------------------------------------------------------------------
// Consistency groups builder
// ---------------------------------------------------------------------------

type ConsistencyGroup = {
  label: string;
  caseIndices: number[]; // 0-based indices into the caseRows array, capped at 3 for display
};

function buildConsistencyGroups(caseRows: CaseRow[], maxGroups = 5): ConsistencyGroup[] {
  const map = new Map<string, number[]>();

  caseRows.forEach((row, idx) => {
    const fd = row.form_data ?? {};
    const diagnosis = String(fd.diagnosis ?? "").trim();
    if (!diagnosis) return;
    const pattern = String(fd.pattern ?? "").trim();
    const key = pattern ? `${diagnosis}|||${pattern}` : diagnosis;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(idx);
  });

  return [...map.entries()]
    .filter(([, indices]) => indices.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxGroups)
    .map(([key, indices]) => {
      const [diagnosis, pattern] = key.split("|||");
      const label = pattern
        ? `诊断：${diagnosis} / 证型：${pattern}`
        : `诊断：${diagnosis}`;
      return { label, caseIndices: indices.slice(0, 3) };
    });
}

function extractFirstKeyPoint(ar: Record<string, unknown> | null): string {
  if (!ar) return "";
  // v1.2+ format: 重点结论 is a string array
  const newPoints = ar["重点结论"];
  if (Array.isArray(newPoints) && newPoints.length > 0) {
    return String(newPoints[0]).slice(0, 40);
  }
  // Legacy format: keyPoints array
  const oldPoints = ar.keyPoints;
  if (Array.isArray(oldPoints) && oldPoints.length > 0) {
    return String(oldPoints[0]).slice(0, 40);
  }
  return "";
}

function buildConsistencyGroupsBlock(caseRows: CaseRow[], groups: ConsistencyGroup[]): string {
  if (groups.length === 0) return "";

  const lines: string[] = [
    "",
    `=== 一致性对照组（CONSISTENCY_GROUPS，共 ${groups.length} 组）===`,
    "以下各组为诊断/证型相同的病案，均来自本次审查样本。",
    "请在 consistency 类别中指出：相似临床描述下，AI 核心结论是否一致？criticalRisk 触发是否稳定？治疗建议方向是否相互矛盾？",
    "若各组输出高度一致、无矛盾，consistency 返回 []。",
    "",
  ];

  groups.forEach((group, gi) => {
    const caseNums = group.caseIndices.map((i) => i + 1).join(", ");
    lines.push(`GROUP_${gi + 1}（${group.label}，${group.caseIndices.length} 条 → 案例 ${caseNums}）:`);
    group.caseIndices.forEach((idx) => {
      const row = caseRows[idx];
      const fd = row.form_data ?? {};
      const ar = row.analysis_result;
      const sex = String(fd.patientSex ?? "?");
      const age = String(fd.patientAge ?? "?");
      const chief = String(fd.chiefComplaint ?? "").slice(0, 20);
      const hasCritical = ar?.criticalRisk != null ? "有" : "无";
      const keyPoint = extractFirstKeyPoint(ar);
      lines.push(
        `  CASE_${idx + 1}: ${sex}${age}岁 "${chief}" → 警示:[${hasCritical}] 重点:${keyPoint || "（空）"}`,
      );
    });
    lines.push("");
  });

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Feedback block builder
// ---------------------------------------------------------------------------

function buildFeedbackBlock(feedbacks: FeedbackRow[]): string {
  if (feedbacks.length === 0) return "";
  return [
    "",
    `=== 医生反馈（DOCTOR_FEEDBACK，${feedbacks.length} 条）===`,
    "以下为医生在使用本系统中留下的文字反馈，已匿名，无医生身份信息。",
    "请在 userFeedbackSummary 字段中总结主要反馈模式。",
    "若反馈内容分散、无明显共性，可写「反馈内容分散，无明显共性」。",
    "",
    ...feedbacks.map((f, i) => `${i + 1}. ${f.ai_feedback}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runOutputAudit({
  client,
  windowDays = 14,
  sampleCap = 100,
  feedbackCap = 50,
}: {
  client: SupabaseClient;
  windowDays?: number;
  sampleCap?: number;
  feedbackCap?: number;
}): Promise<OutputAuditRow> {
  const { windowStart, windowEnd } = await buildWindowFromLatestAnalysis(client, windowDays);

  // Fetch cases — newest first, cap at sampleCap
  const { data: caseData, error: caseError } = await client
    .from("consultations")
    .select("form_data,analysis_result,analyzed_at")
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lt("analyzed_at", windowEnd.toISOString())
    .order("analyzed_at", { ascending: false })
    .limit(sampleCap);

  if (caseError) throw new Error(caseError.message);

  const caseRows = (caseData ?? []) as CaseRow[];
  const sampleSize = caseRows.length;

  if (sampleSize === 0) {
    throw new Error(`最近 ${windowDays} 天无已分析病案，无法生成审查。`);
  }

  // Fetch feedback — within the same window, newest first, cap at feedbackCap
  const { data: feedbackData } = await client
    .from("consultations")
    .select("ai_feedback")
    .not("ai_feedback", "is", null)
    .neq("ai_feedback", "")
    .gte("ai_feedback_updated_at", windowStart.toISOString())
    .lt("ai_feedback_updated_at", windowEnd.toISOString())
    .order("ai_feedback_updated_at", { ascending: false })
    .limit(feedbackCap);

  const feedbackRows = (feedbackData ?? []) as FeedbackRow[];

  const serialized = serializeConsultationsCompact(caseRows);
  const feedbackBlock = buildFeedbackBlock(feedbackRows);
  const consistencyGroups = buildConsistencyGroups(caseRows);
  const consistencyBlock = buildConsistencyGroupsBlock(caseRows, consistencyGroups);
  const model = getDeepSeekFastModel();
  const systemPrompt = buildOutputAuditSystemPrompt();

  const userPrompt = [
    `请对以下 ${sampleSize} 条来自不同医生的病案 AI 输出进行系统审查。`,
    `窗口：${windowStart.toISOString().slice(0, 10)} — ${windowEnd.toISOString().slice(0, 10)}`,
    `当前提示词版本：${TCM_ANALYSIS_PROMPT_VERSION}`,
    consistencyGroups.length > 0
      ? `一致性对照组：${consistencyGroups.length} 组（共 ${consistencyGroups.reduce((s, g) => s + g.caseIndices.length, 0)} 条）`
      : "一致性对照组：样本中无相同诊断/证型的重复组合，consistency 返回 []。",
    "",
    serialized,
    consistencyBlock,
    feedbackBlock,
  ].join("\n");

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "output-audit",
    metadata: {
      windowDays,
      sampleCap,
      sampleSize,
      feedbackCount: feedbackRows.length,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
    },
  });

  const callStartedAt = Date.now();

  const result = await callDeepSeekJson<OutputAuditResult>({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model,
    maxTokens: 5000,
    repairJson: true,
  });

  if (langfuse && trace) {
    trace.generation({
      name: "deepseek-output-audit",
      model: result.model,
      startTime: new Date(callStartedAt),
      endTime: new Date(),
      usageDetails: {
        input: result.usage?.prompt_tokens ?? 0,
        output: result.usage?.completion_tokens ?? 0,
        total: result.usage?.total_tokens ?? 0,
        cacheHit: result.usage?.prompt_cache_hit_tokens ?? 0,
        cacheMiss: result.usage?.prompt_cache_miss_tokens ?? 0,
      },
      metadata: {
        repairedJson: result.repairedJson ?? false,
        latencyMs: Date.now() - callStartedAt,
        sampleSize,
        feedbackCount: feedbackRows.length,
        windowDays,
      },
    });
    try { await langfuse.flushAsync(); } catch { /* non-critical */ }
  }

  // Ensure categories have all keys (default empty arrays if AI skipped any)
  const rawCategories = result.data.categories ?? {};
  const categories: AuditCategories = {
    hallucination: rawCategories.hallucination ?? [],
    reliability: rawCategories.reliability ?? [],
    safety: rawCategories.safety ?? [],
    completeness: rawCategories.completeness ?? [],
    tone: rawCategories.tone ?? [],
    structure: rawCategories.structure ?? [],
    consistency: rawCategories.consistency ?? [],
  };

  const audit: OutputAuditResult = {
    ...result.data,
    categories,
    userFeedbackSummary: result.data.userFeedbackSummary ?? null,
  };

  const { data: inserted, error: insertError } = await client
    .from("analytics_output_audits")
    .insert({
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      prior_review_id: null,
      prompt_version_at_run: `${OUTPUT_AUDIT_PROMPT_VERSION}/${TCM_ANALYSIS_PROMPT_VERSION}`,
      sample_size: sampleSize,
      model: result.model,
      review: audit,
    })
    .select("*")
    .single();

  if (insertError) throw new Error(insertError.message);

  return inserted as OutputAuditRow;
}

