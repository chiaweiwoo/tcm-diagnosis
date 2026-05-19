/**
 * Doctor profile evaluation pipeline — Goal 2.
 *
 * v1.1 keeps deterministic math in TypeScript and asks DeepSeek only for
 * compact synthesis. The profile is admin-only and describes recording habits
 * / AI interaction patterns, not clinical correctness.
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

export const DOCTOR_EVALUATION_PROMPT_VERSION = "doctor-eval-v1.1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldCompletenessStat = {
  field: "pastHistory" | "physicalExam" | "doctorQuestion";
  label: string;
  filled: number;
  total: number;
  rate: number;
};

export type ThemeCandidate = {
  theme: string;
  count: number;
  rate: number;
  caseNumbers: number[];
};

export type DoctorProfile = {
  profileSummary: string;
  fieldCompleteness: Array<{
    field: string;
    label: string;
    filled: number;
    total: number;
    rate: number;
  }>;
  aiRecurringThemes: Array<{
    theme: string;
    frequency: string;
    caseNumbers: number[];
  }>;
  strengths: Array<{
    text: string;
    caseNumbers: number[];
  }>;
  gaps: Array<{
    field: string;
    inputRate: number;
    aiAskRate: number;
    evidence: string;
    caseNumbers: number[];
    guidanceHint: string;
  }>;
  guidancePoints: Array<{
    text: string;
    caseNumbers: number[];
  }>;
};

export type DoctorEvaluation = {
  doctorProfile: DoctorProfile;
};

type EvalRow = {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
};

// ---------------------------------------------------------------------------
// Deterministic stats
// ---------------------------------------------------------------------------

const MAX_EVAL_CASES = 8;

const FIELD_LABELS: Record<FieldCompletenessStat["field"], string> = {
  pastHistory: "既往史",
  physicalExam: "体格检查",
  doctorQuestion: "医生问题",
};

const THEME_PATTERNS: Array<{ theme: string; patterns: RegExp[] }> = [
  { theme: "既往史补充", patterns: [/既往史|病史|用药史|过敏史/] },
  { theme: "血压随访", patterns: [/血压|高血压|降压/] },
  { theme: "体格检查补充", patterns: [/体格检查|查体|体征|压痛|活动度|ROM/i] },
  { theme: "舌脉补充", patterns: [/舌|脉|舌脉/] },
  { theme: "补肾", patterns: [/补肾|肾虚|益肾/] },
  { theme: "补气", patterns: [/补气|益气|气虚/] },
  { theme: "活血", patterns: [/活血|化瘀|血瘀/] },
  { theme: "温阳", patterns: [/温阳|阳虚|温补/] },
];

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function cell(s: string, max: number): string {
  return truncate(s.replace(/[|\n\r]/g, " ").trim(), max);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isFilled(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return stringValue(value).length > 0;
}

function joinArray(arr: unknown, max = 1, sep = "；"): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, max)
    .join(sep);
}

function collectAnalysisText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAnalysisText(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectAnalysisText(item, out);
  }
  return out;
}

export function sampleRecentCases(rows: EvalRow[], maxCases = MAX_EVAL_CASES): EvalRow[] {
  if (rows.length <= maxCases) return rows;

  const byRecency = [...rows].reverse();
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

  const typeQueues = [...queues.values()];
  const picked = new Set<EvalRow>();
  let round = 0;
  while (picked.size < maxCases) {
    let added = false;
    for (const q of typeQueues) {
      if (picked.size >= maxCases) break;
      const next = q[round];
      if (next && !picked.has(next)) {
        picked.add(next);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }

  return [...picked].sort(
    (a, b) => new Date(a.analyzed_at ?? 0).getTime() - new Date(b.analyzed_at ?? 0).getTime(),
  );
}

export function computeFieldCompleteness(rows: EvalRow[]): FieldCompletenessStat[] {
  const total = rows.length;
  return (Object.keys(FIELD_LABELS) as FieldCompletenessStat["field"][]).map((field) => {
    const filled = rows.filter((row) => isFilled(row.form_data?.[field])).length;
    return {
      field,
      label: FIELD_LABELS[field],
      filled,
      total,
      rate: total > 0 ? filled / total : 0,
    };
  });
}

export function extractThemeCandidates(rows: EvalRow[]): ThemeCandidate[] {
  const total = rows.length;
  const candidates = THEME_PATTERNS.map(({ theme, patterns }) => {
    const caseNumbers: number[] = [];
    rows.forEach((row, index) => {
      const text = collectAnalysisText(row.analysis_result).join(" ");
      if (patterns.some((pattern) => pattern.test(text))) {
        caseNumbers.push(index + 1);
      }
    });
    return {
      theme,
      count: caseNumbers.length,
      rate: total > 0 ? caseNumbers.length / total : 0,
      caseNumbers,
    };
  });

  return candidates
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
}

function enforceDualEvidenceGaps(profile: DoctorProfile, completeness: FieldCompletenessStat[]): DoctorProfile {
  const completenessByField = new Map(completeness.map((item) => [item.field, item]));
  return {
    ...profile,
    fieldCompleteness: completeness,
    gaps: profile.gaps
      .map((gap) => {
        const stat = completenessByField.get(gap.field as FieldCompletenessStat["field"]);
        return stat ? { ...gap, inputRate: stat.rate } : gap;
      })
      .filter((gap) => gap.inputRate < 0.7 && gap.aiAskRate >= 0.3)
      .slice(0, 4),
  };
}

export function normalizeDoctorProfile(value: unknown): DoctorProfile {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};

  const listObjects = <T>(key: string): T[] => Array.isArray(raw[key]) ? raw[key] as T[] : [];
  const textList = (key: string): string[] => Array.isArray(raw[key])
    ? (raw[key] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  const guidancePoints = Array.isArray(raw.guidancePoints)
    ? (raw.guidancePoints as unknown[])
        .filter((item): item is DoctorProfile["guidancePoints"][number] => (
          Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string"
        ))
    : [];
  const oldGuidance = textList("guidancePoints").map((text) => ({ text, caseNumbers: [] }));
  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps as Array<Record<string, unknown>> : [];
  const v11Gaps = rawGaps
    .filter((gap) => "field" in gap || "inputRate" in gap || "aiAskRate" in gap || "evidence" in gap)
    .map((gap) => gap as DoctorProfile["gaps"][number]);
  const oldGaps = rawGaps
    .filter((gap) => !("field" in gap || "inputRate" in gap || "aiAskRate" in gap || "evidence" in gap))
    .map((gap) => ({
      field: stringValue(gap.gap) || "legacy",
      inputRate: 0,
      aiAskRate: 0,
      evidence: stringValue(gap.frequency),
      caseNumbers: [],
      guidanceHint: stringValue(gap.guidanceHint),
    }));

  return {
    profileSummary: stringValue(raw.profileSummary) || "暂无可展示的画像摘要。",
    fieldCompleteness: listObjects<DoctorProfile["fieldCompleteness"][number]>("fieldCompleteness"),
    aiRecurringThemes: listObjects<DoctorProfile["aiRecurringThemes"][number]>("aiRecurringThemes"),
    strengths: listObjects<DoctorProfile["strengths"][number]>("strengths"),
    gaps: v11Gaps.length ? v11Gaps : oldGaps,
    guidancePoints: guidancePoints.length ? guidancePoints : oldGuidance,
  };
}

export function serializeConsultationsCompact(rows: EvalRow[]): string {
  const SEP = " | ";
  const headers = [
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
      cell(joinArray(ar?.keyPoints, 1), 50),
      cell(joinArray(g1?.sections?.[0]?.items, 1), 50),
      cell(joinArray(g0?.sections?.[1]?.items, 1), 50),
      cell(joinArray(ar?.cautions as unknown[], 1), 50),
    ].join(SEP);
  });

  return [
    `列说明：#=案例编号 | 生命体征=[有]/[无] | 既往史=[未填]表示未填写 | 医问=空表示未填写`,
    headers,
    ...dataRows,
  ].join("\n");
}

function serializeStats(completeness: FieldCompletenessStat[], themes: ThemeCandidate[]) {
  const total = themes[0]?.rate ? Math.round(themes[0].count / themes[0].rate) : (completeness[0]?.total ?? 0);
  const completenessLines = completeness
    .map((item) => `${item.field}/${item.label}: ${item.filled}/${item.total} (${Math.round(item.rate * 100)}%)`)
    .join("\n");
  const themeLines = themes
    .slice(0, 8)
    .map((item) => `${item.theme}: ${item.count}/${total} (${Math.round(item.rate * 100)}%) cases=${item.caseNumbers.join(",")}`)
    .join("\n");

  return [
    "DETERMINISTIC_FIELD_COMPLETENESS",
    completenessLines || "none",
    "",
    "DETERMINISTIC_AI_THEME_CANDIDATES",
    themeLines || "none",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

export async function evaluateDoctor(
  client: SupabaseClient,
  doctorId: string,
  windowDays = 14,
): Promise<{
  evaluation: DoctorEvaluation;
  consultationCount: number;
  model: string;
  promptVersion: string;
}> {
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
  if (consultationCount === 0) throw new NoConsultationsError(windowDays);

  const sampled = sampleRecentCases(rows);
  const fieldCompleteness = computeFieldCompleteness(rows);
  const themeCandidates = extractThemeCandidates(sampled);
  const serialized = serializeConsultationsCompact(sampled);
  const stats = serializeStats(fieldCompleteness, themeCandidates);

  const userPrompt = [
    `请对以下 ${sampled.length} 条病案进行医生画像分析（窗口内共 ${consultationCount} 条，已按处方类型分层取最近 ${sampled.length} 条）。`,
    `窗口：过去 ${windowDays} 天`,
    "请优先使用我提供的确定性统计，不要重新发明百分比。",
    "",
    stats,
    "",
    "COMPACT_CASES",
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
    maxTokens: 2000,
    timeoutMs: 90_000,
    repairJson: true,
    retryOnEmpty: true,
    jsonMode: false,
  });

  if (langfuse && trace) {
    trace.generation({
      name: "deepseek-evaluate",
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
        consultationCount,
        sampledCount: sampled.length,
        windowDays,
      },
    });
    try { await langfuse.flushAsync(); } catch { /* non-critical */ }
  }

  const normalizedProfile = normalizeDoctorProfile(result.data.doctorProfile);
  const doctorProfile = enforceDualEvidenceGaps(normalizedProfile, fieldCompleteness);

  return {
    evaluation: { doctorProfile },
    consultationCount,
    model,
    promptVersion: DOCTOR_EVALUATION_PROMPT_VERSION,
  };
}

export async function insertDoctorEvaluation({
  client,
  doctorId,
  windowDays,
  evaluation,
  consultationCount,
  model,
}: {
  client: SupabaseClient;
  doctorId: string;
  windowDays: number;
  evaluation: DoctorEvaluation;
  consultationCount: number;
  model: string;
}) {
  const { windowStart, windowEnd } = buildWindow(windowDays);
  const { data, error } = await client
    .from("analytics_doctor_evaluations")
    .insert({
      doctor_id: doctorId,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      consultation_count: consultationCount,
      doctor_profile: evaluation.doctorProfile,
      model,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
