/**
 * Fleet-wide AI output audit — Goal 1 (v2).
 *
 * Audits AI output quality across all doctors over a rolling window.
 * On-demand only. Stored in analytics_output_audits. Never shown to doctors.
 *
 * v2 changes vs legacy session review:
 *  - 6-category Finding schema (hallucination/reliability/safety/completeness/tone/structure)
 *  - findingKey for stable cross-round matching ("category:shortName")
 *  - self-contained exampleCases.summary (no case number references)
 *  - severity grounded in patient health risk rubric
 *  - definitions embedded from auditDefinitions.ts (single source of truth)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { buildOutputAuditSystemPrompt, OUTPUT_AUDIT_PROMPT_VERSION } from "./prompts";
import { TCM_ANALYSIS_PROMPT_VERSION } from "@/lib/ai/prompts";
import { buildWindow } from "./stats";
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
};

export type PriorStatus = {
  findingKey: string;
  priorShortName: string;
  priorObservation: string;
  priorSuggestion: string;
  status: "resolved" | "partial" | "untriggered" | "regressed";
  evidence: string;
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
  priorImprovementStatus: PriorStatus[] | null;
  promptVersionsCompared: { prior: string; current: string } | null;
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
// Sampling — stratified by prescriptionType, up to perGroupMax per group
// ---------------------------------------------------------------------------

type RawRow = {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
};

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
// Build prior-findings block for the user prompt
// ---------------------------------------------------------------------------

function buildPriorAuditBlock(prior: OutputAuditRow): string {
  const allFindings: Finding[] = [];
  const cats = prior.review.categories;
  if (cats) {
    for (const key of CATEGORY_ORDER) {
      const findings = cats[key as keyof AuditCategories] ?? [];
      allFindings.push(...findings);
    }
  }

  if (allFindings.length === 0) return "";

  const lines = [
    "",
    "=== 上一轮审查结果（PRIOR_AUDIT）===",
    `prior_prompt_version: ${prior.prompt_version_at_run}`,
    "prior_findings:",
    JSON.stringify(
      allFindings.map((f) => ({
        findingKey: f.findingKey,
        shortName: f.shortName,
        observation: f.observation,
        suggestedFix: f.suggestedFix ?? "",
      })),
      null,
      2,
    ),
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runOutputAudit({
  client,
  priorAuditId,
  windowDays = 14,
  perGroupMax = 10,
}: {
  client: SupabaseClient;
  priorAuditId?: string | null;
  windowDays?: number;
  perGroupMax?: number;
}): Promise<OutputAuditRow> {
  const { windowStart, windowEnd } = buildWindow(windowDays);

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

  // Resolve prior audit for chaining
  let priorAudit: OutputAuditRow | null = null;
  let resolvedPriorId = priorAuditId ?? null;

  if (resolvedPriorId) {
    const { data: prior } = await client
      .from("analytics_output_audits")
      .select("*")
      .eq("id", resolvedPriorId)
      .maybeSingle();
    priorAudit = prior as OutputAuditRow | null;
  } else {
    const { data: latest } = await client
      .from("analytics_output_audits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      priorAudit = latest as OutputAuditRow;
      resolvedPriorId = latest.id;
    }
  }

  const serialized = serializeConsultationsCompact(sampled);
  const model = getDeepSeekFastModel();
  const systemPrompt = buildOutputAuditSystemPrompt();

  const userPrompt = [
    `请对以下 ${sampleSize} 条来自不同医生的病案 AI 输出进行系统审查。`,
    `窗口：过去 ${windowDays} 天`,
    `当前提示词版本：${TCM_ANALYSIS_PROMPT_VERSION}`,
    "",
    serialized,
    ...(priorAudit ? [buildPriorAuditBlock(priorAudit)] : []),
  ].join("\n");

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "output-audit",
    metadata: {
      windowDays,
      perGroupMax,
      sampleSize,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      hasPrior: !!priorAudit,
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
        windowDays,
        hasPrior: !!priorAudit,
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
    priorImprovementStatus: priorAudit ? (result.data.priorImprovementStatus ?? null) : null,
    promptVersionsCompared: priorAudit
      ? (result.data.promptVersionsCompared ?? {
          prior: priorAudit.prompt_version_at_run,
          current: TCM_ANALYSIS_PROMPT_VERSION,
        })
      : null,
  };

  const { data: inserted, error: insertError } = await client
    .from("analytics_output_audits")
    .insert({
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      prior_review_id: resolvedPriorId,
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
