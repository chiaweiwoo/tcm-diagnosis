/**
 * Doctor evaluation pipeline — Sprint 6 (Goal 1 + Goal 2).
 *
 * Goal 1 (outputReview):  evaluate AI output quality across recent consultations —
 *   alignment, specificity, anomalies, structural completeness.
 *
 * Goal 2 (doctorProfile): analyse doctor's input patterns, identify recurring gaps
 *   between input and AI suggestions, compute internal score (never shown to doctor).
 *
 * Compact serialization reduces token cost ~60% vs raw JSON by eliminating
 * repeated field names and truncating long free-text fields.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { DOCTOR_EVALUATION_SYSTEM_PROMPT } from "./prompts";
import { buildWindow } from "./stats";
import { getLangfuse } from "@/lib/langfuse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseFinding = {
  caseIndex: number;
  alignmentOk: boolean;
  issues: string[];
  strengths: string[];
};

export type OutputReview = {
  verdict: "stable" | "needs_attention" | "critical";
  caseFindings: CaseFinding[];
  crossCasePatterns: string[];
  reviewSummary: string;
};

export type GapEntry = {
  gap: string;
  frequency: string;
  guidanceHint: string;
};

export type DoctorProfile = {
  internalScore: number;
  prescriptionStyle: string;
  inputCompleteness: "high" | "medium" | "low";
  weakFields: string[];
  gaps: GapEntry[];
  guidancePoints: string[];
  profileSummary: string;
};

export type DoctorEvaluation = {
  outputReview: OutputReview;
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

function serializeConsultationsCompact(rows: EvalRow[]): string {
  return rows
    .map((row, i) => {
      const fd = row.form_data ?? {};
      const ar = row.analysis_result;

      const types = Array.isArray(fd.prescriptionType)
        ? (fd.prescriptionType as string[]).join("+")
        : String(fd.prescriptionType ?? "方药");

      const lines: string[] = [
        `=== 案例 ${i + 1} | ${fd.patientSex ?? "?"}/${fd.patientAge ?? "?"}岁 | ${types} ===`,
        `主诉: ${truncate(String(fd.chiefComplaint ?? ""), 80)}`,
        `诊断: ${String(fd.diagnosis ?? "")} | 证型: ${String(fd.pattern ?? "")}`,
        fd.currentIllness
          ? `现病史: ${truncate(String(fd.currentIllness), 100)}`
          : "",
        `体检: ${truncate(String(fd.physicalExam ?? ""), 60)}`,
        `处方: ${truncate(String(fd.prescription ?? ""), 100)}`,
        fd.doctorQuestion
          ? `医生问题: ${truncate(String(fd.doctorQuestion), 60)}`
          : "",
        "---AI---",
      ];

      if (ar && typeof ar === "object") {
        // keyPoints
        const kp = joinArray(ar.keyPoints, 2);
        if (kp) lines.push(`重点: ${kp}`);

        // groups[0] = 判断 (可取之处, 需要复核)
        const groups = ar.groups as Array<{ sections?: Array<{ items?: unknown[] }> }> | undefined;
        const g0 = groups?.[0];
        const merits = joinArray(g0?.sections?.[0]?.items, 2);
        const review = joinArray(g0?.sections?.[1]?.items, 2);
        if (merits) lines.push(`可取: ${merits}`);
        if (review) lines.push(`复核: ${review}`);

        // groups[1] = 方案 (建议优化, 可选思路)
        const g1 = groups?.[1];
        const suggestions = joinArray(g1?.sections?.[0]?.items, 2);
        if (suggestions) lines.push(`建议: ${suggestions}`);

        // cautions
        const cautions = joinArray(ar.cautions as unknown[], 2);
        if (cautions) lines.push(`风险: ${cautions}`);

        // evidence (just first item, truncated)
        const evidenceArr = ar.evidence as unknown[];
        if (Array.isArray(evidenceArr) && evidenceArr.length > 0) {
          lines.push(`证据: ${truncate(String(evidenceArr[0]), 50)}`);
        }
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
  windowDays = 7,
): Promise<{ evaluation: DoctorEvaluation; consultationCount: number; model: string }> {
  const { windowStart, windowEnd } = buildWindow(windowDays);

  // Fetch recent analyzed consultations
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
    throw new Error("该医生在指定窗口内没有已分析的病案。");
  }

  const serialized = serializeConsultationsCompact(rows);

  const userPrompt = [
    `请对以下 ${consultationCount} 条病案进行双重评估（AI输出审核 + 医生画像）。`,
    `窗口：过去 ${windowDays} 天`,
    "",
    serialized,
    "",
    "请严格按照输出结构返回 JSON，caseFindings 数组长度必须为 " + consultationCount + "。",
  ].join("\n");

  const model = getDeepSeekFastModel();
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
    maxTokens: 3000,
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
