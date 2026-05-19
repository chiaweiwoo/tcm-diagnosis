/**
 * Doctor profile evaluation pipeline — Goal 2.
 *
 * Analyses a single doctor's input patterns over a rolling window (default 14d).
 * On-demand only — triggered by admin UI or GH Action workflow_dispatch.
 *
 * Goal 1 (AI output review) moved to sessionReview.ts — fleet-wide, on-demand.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekSmartModel } from "@/lib/ai/deepseek";
import { DOCTOR_EVALUATION_SYSTEM_PROMPT } from "./prompts";
import { buildWindow } from "./stats";
import { getLangfuse } from "@/lib/langfuse";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoConsultationsError extends Error {
  constructor(windowDays: number) {
    super(`本医生最近 ${windowDays} 天无已分析的病案，无法生成评估。`);
    this.name = "NoConsultationsError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StrengthEntry = {
  strength: string;
  evidence: string; // "案例1、3、5"
};

export type FieldCompletenessEntry = {
  field: string;
  presentIn: string; // "9/10"
};

export type AiRecurringThemes = {
  frequentSuggestions: string[];
  frequentRisks: string[];
  frequentClarifications: string[];
};

export type GapEntry = {
  gap: string;
  presentIn?: string;  // v1.1+: "3/10"
  evidence?: string;   // v1.1+: "案例3、7、9"
  frequency?: string;  // v1.0 compat
  guidanceHint: string;
};

export type DoctorProfile = {
  internalScore: number;
  scoreDirection: "improving" | "stable" | "declining" | "first_run";
  prescriptionStyle: string;
  profileSummary: string;
  gaps: GapEntry[];
  guidancePoints: string[];
  /** Stored for Phase 2 doctor-facing surface. Not rendered in admin UI yet. */
  doctorFacingHint: string;

  // v1.1+ fields (optional for backward compat with old DB records)
  headline?: string;
  strengths?: StrengthEntry[];
  fieldCompleteness?: FieldCompletenessEntry[];
  aiRecurringThemes?: AiRecurringThemes;

  // v1.0 deprecated (kept for reading old DB records)
  inputCompleteness?: "high" | "medium" | "low";
  weakFields?: string[];
};

export type DoctorEvaluation = {
  doctorProfile: DoctorProfile;
};

// ---------------------------------------------------------------------------
// Internal row type
// ---------------------------------------------------------------------------

type EvalRow = {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
};

// ---------------------------------------------------------------------------
// Compact serializer — reduces token cost vs raw JSON by ~60%
// ---------------------------------------------------------------------------

// Max consultations sent to the evaluation model.
// Stratified by prescription type, most recent cases preferred.
const MAX_EVAL_CASES = 8;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function cell(s: string, max: number): string {
  // Strip pipes and newlines so table columns stay intact
  return truncate(s.replace(/[|\n\r]/g, " ").trim(), max);
}

function joinArray(arr: unknown, max = 1, sep = "；"): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, max)
    .join(sep);
}

/**
 * Stratified recent sample — most recent cases first, spread across
 * prescription types so the model sees variety. Returns at most MAX_EVAL_CASES
 * rows sorted back to chronological order.
 */
export function sampleRecentCases(rows: EvalRow[], maxCases = MAX_EVAL_CASES): EvalRow[] {
  if (rows.length <= maxCases) return rows;

  // rows come in ASC order; reverse = most recent first
  const byRecency = [...rows].reverse();

  // Group by prescription type string
  const queues = new Map<string, EvalRow[]>();
  for (const row of byRecency) {
    const fd = row.form_data ?? {};
    const key = Array.isArray(fd.prescriptionType)
      ? (fd.prescriptionType as string[]).sort().join("+")
      : String(fd.prescriptionType ?? "");
    const q = queues.get(key) ?? [];
    q.push(row);
    queues.set(key, q);
  }

  // Round-robin across types (most recent from each type first)
  const typeQueues = [...queues.values()];
  const picked = new Set<EvalRow>();
  let round = 0;
  while (picked.size < maxCases) {
    let added = false;
    for (const q of typeQueues) {
      if (picked.size >= maxCases) break;
      const next = q[round];
      if (next && !picked.has(next)) { picked.add(next); added = true; }
    }
    if (!added) break;
    round++;
  }

  // Restore chronological order
  return [...picked].sort(
    (a, b) => new Date(a.analyzed_at ?? 0).getTime() - new Date(b.analyzed_at ?? 0).getTime(),
  );
}

/**
 * Tabular serialization — column headers appear once, one row per case.
 * ~40-50% fewer tokens than the old per-case labelled format for 8+ cases.
 *
 * Column legend (prepended):
 *   #  性/岁  类型  主诉  诊断  证型  体检(>15字=详)  生命体征  既往史  处方  医问
 *   AI重点  AI建议  AI复核  AI风险
 */
export function serializeConsultationsCompact(rows: EvalRow[]): string {
  const SEP = " | ";
  const HEADERS = [
    "#", "性/岁", "类型",
    "主诉", "诊断", "证型",
    "体检", "生命体征", "既往史",
    "处方", "医问",
    "AI重点", "AI建议", "AI复核", "AI风险",
  ].join(SEP);

  const dataRows = rows.map((row, i) => {
    const fd = row.form_data ?? {};
    const ar = row.analysis_result;

    const types = Array.isArray(fd.prescriptionType)
      ? (fd.prescriptionType as string[]).join("+")
      : String(fd.prescriptionType ?? "方药");

    const physicalExam = String(fd.physicalExam ?? "");
    const hasVitals = /血压|心率|体温|脉搏/.test(physicalExam);

    const groups = ar?.groups as Array<{ sections?: Array<{ items?: unknown[] }> }> | undefined;
    const g0 = groups?.[0];
    const g1 = groups?.[1];

    return [
      String(i + 1),
      `${fd.patientSex ?? "?"}/${fd.patientAge ?? "?"}`,
      cell(types, 20),
      cell(String(fd.chiefComplaint ?? ""), 50),
      cell(String(fd.diagnosis ?? ""), 30),
      cell(String(fd.pattern ?? ""), 30),
      cell(physicalExam, 60),
      hasVitals ? "[有]" : "[无]",
      fd.pastHistory ? cell(String(fd.pastHistory), 40) : "[未填]",
      cell(String(fd.prescription ?? ""), 80),
      fd.doctorQuestion ? cell(String(fd.doctorQuestion), 40) : "",
      // AI columns — 1 item each to keep rows compact
      cell(joinArray(ar?.keyPoints, 1), 50),
      cell(joinArray(g1?.sections?.[0]?.items, 1), 50),
      cell(joinArray(g0?.sections?.[1]?.items, 1), 50),
      cell(joinArray(ar?.cautions as unknown[], 1), 50),
    ].join(SEP);
  });

  return [
    `列说明：#=案例编号 | 体检>15字为"详" | 生命体征=[有]/[无] | 既往史=[未填]表示未填写 | 医问=空表示未填写`,
    HEADERS,
    ...dataRows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

export async function evaluateDoctor(
  client: SupabaseClient,
  doctorId: string,
  windowDays = 14,
): Promise<{ evaluation: DoctorEvaluation; consultationCount: number; model: string }> {
  const { windowStart, windowEnd } = buildWindow(windowDays);

  const { data, error } = await client
    .from("consultations")
    .select("form_data,analysis_result,analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lt("analyzed_at", windowEnd.toISOString())
    .order("analyzed_at", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as EvalRow[];
  const consultationCount = rows.length;

  if (consultationCount === 0) {
    throw new NoConsultationsError(windowDays);
  }

  // Stratified recent sample — keeps prompt within token budget
  const sampled = sampleRecentCases(rows);
  const serialized = serializeConsultationsCompact(sampled);

  const userPrompt = [
    `请对以下 ${sampled.length} 条病案进行医生画像分析（窗口内共 ${consultationCount} 条，已按处方类型分层取最近 ${sampled.length} 条）。`,
    `窗口：过去 ${windowDays} 天`,
    "",
    serialized,
  ].join("\n");

  const model = getDeepSeekSmartModel();
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "evaluate-doctor",
    metadata: { doctorId, windowDays, consultationCount, sampledCount: sampled.length },
  });

  const callStartedAt = Date.now();

  const result = await callDeepSeekJson<DoctorEvaluation>({
    messages: [
      { role: "system", content: DOCTOR_EVALUATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model,
    maxTokens: 2000,    // schema output ~1000-1400 tokens; cap forces conciseness
    timeoutMs: 90_000,
    repairJson: true,
    retryOnEmpty: true,
    jsonMode: false,    // plain text mode: truncated output returns partial JSON
                        // rather than null; repairJson handles the rest
  });

  if (langfuse && trace) {
    trace.generation({
      name: "deepseek-evaluate",
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
        repairedJson:     result.repairedJson ?? false,
        latencyMs:        Date.now() - callStartedAt,
        consultationCount,
        sampledCount:     sampled.length,
        windowDays,
      },
    });
    try { await langfuse.flushAsync(); } catch { /* non-critical */ }
  }

  return { evaluation: result.data, consultationCount, model };
}
