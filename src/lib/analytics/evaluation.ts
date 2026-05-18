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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function joinArray(arr: unknown, max = 2, sep = "；"): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, max)
    .join(sep);
}

export function serializeConsultationsCompact(rows: EvalRow[]): string {
  return rows
    .map((row, i) => {
      const fd = row.form_data ?? {};
      const ar = row.analysis_result;

      const types = Array.isArray(fd.prescriptionType)
        ? (fd.prescriptionType as string[]).join("+")
        : String(fd.prescriptionType ?? "方药");

      const physicalExam = String(fd.physicalExam ?? "");
      const hasVitals = /血压|心率|体温|脉搏/.test(physicalExam);

      const lines: string[] = [
        `=== 案例 ${i + 1} | ${fd.patientSex ?? "?"}/${fd.patientAge ?? "?"}岁 | ${types} ===`,
        `主诉: ${truncate(String(fd.chiefComplaint ?? ""), 80)}`,
        `诊断: ${String(fd.diagnosis ?? "")} | 证型: ${String(fd.pattern ?? "")}`,
        fd.currentIllness
          ? `现病史: ${truncate(String(fd.currentIllness), 100)}`
          : "",
        `体格检查: ${truncate(physicalExam, 80)}`,
        `生命体征: ${hasVitals ? "[有]" : "[无]"}`,
        fd.pastHistory
          ? `既往病史: ${truncate(String(fd.pastHistory), 60)}`
          : "既往病史: [未填]",
        `处方: ${truncate(String(fd.prescription ?? ""), 100)}`,
        fd.doctorQuestion
          ? `医生问题: ${truncate(String(fd.doctorQuestion), 60)}`
          : "",
        "---AI输出---",
      ];

      if (ar && typeof ar === "object") {
        const kp = joinArray(ar.keyPoints, 2);
        if (kp) lines.push(`重点结论: ${kp}`);

        const groups = ar.groups as Array<{ sections?: Array<{ items?: unknown[] }> }> | undefined;
        const g0 = groups?.[0];
        const merits = joinArray(g0?.sections?.[0]?.items, 2);
        const review = joinArray(g0?.sections?.[1]?.items, 2);
        if (merits) lines.push(`可取之处: ${merits}`);
        if (review) lines.push(`需要复核: ${review}`);

        const g1 = groups?.[1];
        const suggestions = joinArray(g1?.sections?.[0]?.items, 2);
        const alternatives = joinArray(g1?.sections?.[1]?.items, 2);
        if (suggestions) lines.push(`建议优化: ${suggestions}`);
        if (alternatives) lines.push(`可选思路: ${alternatives}`);

        const cautions = joinArray(ar.cautions as unknown[], 2);
        if (cautions) lines.push(`风险与提醒: ${cautions}`);

        const g2 = groups?.[2];
        const followUp = joinArray(g2?.sections?.[0]?.items, 2);
        if (followUp) lines.push(`随访监测: ${followUp}`);
      }

      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
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

  const serialized = serializeConsultationsCompact(rows);

  const userPrompt = [
    `请对以下 ${consultationCount} 条病案进行医生画像分析。`,
    `窗口：过去 ${windowDays} 天`,
    "",
    serialized,
  ].join("\n");

  const model = getDeepSeekSmartModel();
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "evaluate-doctor",
    metadata: { doctorId, windowDays, consultationCount },
  });

  const callStartedAt = Date.now();

  const result = await callDeepSeekJson<DoctorEvaluation>({
    messages: [
      { role: "system", content: DOCTOR_EVALUATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model,
    maxTokens: 2500,
    repairJson: true,
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
        windowDays,
      },
    });
    try { await langfuse.flushAsync(); } catch { /* non-critical */ }
  }

  return { evaluation: result.data, consultationCount, model };
}
