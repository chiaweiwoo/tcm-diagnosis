/**
 * Fleet-wide session review — Goal 1.
 *
 * Reviews AI output quality across all doctors over a rolling window.
 * On-demand only. Used for prompt refinement by the developer/admin.
 * Optionally chains to a prior review to track whether fixes landed.
 *
 * Stored in analytics_session_reviews. Never shown to doctors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekSmartModel } from "@/lib/ai/deepseek";
import { SESSION_REVIEW_SYSTEM_PROMPT, SESSION_REVIEW_PROMPT_VERSION } from "./prompts";
import { TCM_ANALYSIS_PROMPT_VERSION } from "@/lib/ai/prompts";
import { buildWindow } from "./stats";
import { serializeConsultationsCompact } from "./evaluation";
import { getLangfuse } from "@/lib/langfuse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HallucinationPattern = {
  pattern: string;
  affectedCases: number[];
  severity: "low" | "medium" | "high";
};

export type PromptImprovement = {
  issue: string;
  suggestedPromptChange: string;
  affectedCases: number[];
};

export type PriorImprovementStatus = {
  priorIssue: string;
  priorSuggestion: string;
  status: "resolved" | "partial" | "unchanged" | "regressed";
  evidence: string;
};

export type SessionReview = {
  verdict: "stable" | "needs_attention" | "critical";
  hallucinationPatterns: HallucinationPattern[];
  structuralDrift: string[];
  languageIssues: string[];
  promptImprovements: PromptImprovement[];
  priorImprovementStatus: PriorImprovementStatus[] | null;
  promptVersionsCompared: { prior: string; current: string } | null;
  reviewSummary: string;
};

export type SessionReviewRow = {
  id: string;
  created_at: string;
  window_start: string;
  window_end: string;
  prior_review_id: string | null;
  prompt_version_at_run: string;
  sample_size: number;
  model: string;
  review: SessionReview;
};

// ---------------------------------------------------------------------------
// Sampling — stratified by prescriptionType, up to perGroupMax per group
// ---------------------------------------------------------------------------

type RawRow = {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
};

/**
 * Returns up to perGroupMax rows from each prescriptionType bucket.
 * Total = numGroups × perGroupMax (each group contributes independently).
 * If a group has fewer than perGroupMax rows, all rows from that group are kept.
 */
function stratifiedSample(rows: RawRow[], perGroupMax: number): RawRow[] {
  const buckets: Record<string, RawRow[]> = {};
  for (const row of rows) {
    const types = Array.isArray(row.form_data?.prescriptionType)
      ? (row.form_data!.prescriptionType as string[]).join("+")
      : String(row.form_data?.prescriptionType ?? "other");
    (buckets[types] ??= []).push(row);
  }

  const sampled: RawRow[] = [];
  for (const bucket of Object.values(buckets)) {
    sampled.push(...bucket.slice(0, perGroupMax));
  }
  return sampled;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function reviewSession({
  client,
  priorReviewId,
  windowDays = 14,
  perGroupMax = 10,
}: {
  client: SupabaseClient;
  priorReviewId?: string | null;
  windowDays?: number;
  /** Max consultations to sample per prescriptionType group. Default 10. */
  perGroupMax?: number;
}): Promise<SessionReviewRow> {
  const { windowStart, windowEnd } = buildWindow(windowDays);

  // Fetch analyzed consultations across ALL doctors in window
  const { data: rawRows, error } = await client
    .from("consultations")
    .select("form_data,analysis_result,analyzed_at")
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lt("analyzed_at", windowEnd.toISOString())
    .order("analyzed_at", { ascending: false });

  if (error) throw new Error(error.message);

  const allRows = (rawRows ?? []) as RawRow[];
  const sampled = stratifiedSample(allRows, perGroupMax);
  const sampleSize = sampled.length;

  if (sampleSize === 0) {
    throw new Error(`最近 ${windowDays} 天无已分析病案，无法生成审查。`);
  }

  // Resolve prior review for chaining
  let priorReview: SessionReviewRow | null = null;
  let resolvedPriorId = priorReviewId ?? null;

  if (resolvedPriorId) {
    const { data: prior } = await client
      .from("analytics_session_reviews")
      .select("*")
      .eq("id", resolvedPriorId)
      .maybeSingle();
    priorReview = prior as SessionReviewRow | null;
  } else {
    // Default: auto-link to most recent review
    const { data: latest } = await client
      .from("analytics_session_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      priorReview = latest as SessionReviewRow;
      resolvedPriorId = latest.id;
    }
  }

  const serialized = serializeConsultationsCompact(sampled);
  const model = getDeepSeekSmartModel();

  // Build user prompt
  const promptParts = [
    `请对以下 ${sampleSize} 条来自不同医生的病案 AI 输出进行系统审查。`,
    `窗口：过去 ${windowDays} 天`,
    `当前提示词版本：${TCM_ANALYSIS_PROMPT_VERSION}`,
    "",
    serialized,
  ];

  if (priorReview) {
    promptParts.push(
      "",
      "=== 上一轮审查结果（请追踪以下问题的落实状态）===",
      `上一轮提示词版本：${priorReview.prompt_version_at_run}`,
      `上一轮改进建议：`,
      JSON.stringify(priorReview.review.promptImprovements ?? [], null, 2),
    );
  }

  const userPrompt = promptParts.join("\n");

  // Langfuse
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "session-review",
    metadata: {
      windowDays,
      perGroupMax,
      sampleSize,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      hasPrior: !!priorReview,
    },
  });

  const callStartedAt = Date.now();

  const result = await callDeepSeekJson<SessionReview>({
    messages: [
      { role: "system", content: SESSION_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model,
    maxTokens: 4000,
    repairJson: true,
  });

  if (langfuse && trace) {
    trace.generation({
      name: "deepseek-session-review",
      model: result.model,
      startTime: new Date(callStartedAt),
      endTime: new Date(),
      usageDetails: {
        input:     result.usage?.prompt_tokens             ?? 0,
        output:    result.usage?.completion_tokens         ?? 0,
        total:     result.usage?.total_tokens              ?? 0,
        cacheHit:  result.usage?.prompt_cache_hit_tokens   ?? 0,
        cacheMiss: result.usage?.prompt_cache_miss_tokens  ?? 0,
      },
      metadata: {
        repairedJson: result.repairedJson ?? false,
        latencyMs:    Date.now() - callStartedAt,
        sampleSize,
        windowDays,
        hasPrior: !!priorReview,
      },
    });
    try { await langfuse.flushAsync(); } catch { /* non-critical */ }
  }

  // Ensure null fields are present when no prior
  const review: SessionReview = {
    ...result.data,
    priorImprovementStatus: priorReview ? (result.data.priorImprovementStatus ?? null) : null,
    promptVersionsCompared: priorReview
      ? (result.data.promptVersionsCompared ?? {
          prior: priorReview.prompt_version_at_run,
          current: TCM_ANALYSIS_PROMPT_VERSION,
        })
      : null,
  };

  // Insert row
  const { data: inserted, error: insertError } = await client
    .from("analytics_session_reviews")
    .insert({
      window_start:         windowStart.toISOString(),
      window_end:           windowEnd.toISOString(),
      prior_review_id:      resolvedPriorId,
      prompt_version_at_run: TCM_ANALYSIS_PROMPT_VERSION,
      sample_size:          sampleSize,
      model:                result.model,
      review,
    })
    .select("*")
    .single();

  if (insertError) throw new Error(insertError.message);

  return inserted as SessionReviewRow;
}
