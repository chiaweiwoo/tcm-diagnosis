/**
 * Fleet-wide AI output audit — Goal 1 (v3).
 *
 * Audits AI output quality across all doctors over a rolling window anchored
 * to the fleet's most recent analyzed_at timestamp.
 * On-demand only. Stored in analytics_output_audits. Never shown to doctors.
 *
 * v3: window anchored to MAX(analyzed_at) fleet-wide; newest-first cap-100
 * sampling; doctor feedback corpus (cap 50, anonymised); no prior-audit chaining.
 * Consistency testing is handled locally via scratch/consistency_check.mjs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { getPrompt } from "@/lib/prompts";
import { buildWindowFromLatestAnalysis } from "./stats";
import { serializeConsultationsCompact } from "./serializeConsultationsCompact";
import { getLangfuse } from "@/lib/langfuse";

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
  const model = getDeepSeekFastModel();

  // Resolve prompts from Prompt Registry
  const { version: auditVersion, prompt: systemPrompt } = getPrompt("output-audit");
  const { version: tcmVersion } = getPrompt("tcm-analysis");

  const userPrompt = [
    `请对以下 ${sampleSize} 条来自不同医生的病案 AI 输出进行系统审查。`,
    `窗口：${windowStart.toISOString().slice(0, 10)} — ${windowEnd.toISOString().slice(0, 10)}`,
    `当前提示词版本：${tcmVersion}`,
    "",
    serialized,
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
      promptVersion: tcmVersion,
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
      prompt_version_at_run: `${auditVersion}/${tcmVersion}`,
      sample_size: sampleSize,
      model: result.model,
      review: audit,
    })
    .select("*")
    .single();

  if (insertError) throw new Error(insertError.message);

  return inserted as OutputAuditRow;
}
