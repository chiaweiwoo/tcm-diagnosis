/**
 * Doctor profile evaluation pipeline — Goal 2.
 *
 * Two-stage pipeline:
 *   Stage 1 — Observer (analyzeConsultations): pure TypeScript, deterministic.
 *              Computes field completeness, promotes AI themes, detects gaps via
 *              dual-evidence rule, and identifies strength signals. No LLM.
 *
 *   Stage 2 — Narrator (narrateFindings): LLM call for language synthesis only.
 *              Receives pre-computed findings; writes profileSummary, strengths,
 *              gap evidence/guidance, and guidancePoints.
 *
 * The LLM cannot invent field names, rates, gap candidates, or case numbers —
 * all structural decisions are made in Stage 1. This keeps the model task
 * trivial (prose generation), scales independently of case volume, and makes
 * Stage 1 logic fully testable as pure functions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import {
  DOCTOR_EVALUATION_SYSTEM_PROMPT,
  DOCTOR_EVALUATION_PROMPT_VERSION,
} from "./prompts";
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

export type FieldCompletenessStat = {
  field: "pastHistory" | "physicalExam";
  label: string;
  filled: number;
  total: number;
  rate: number;
};

export type PatientDistribution = {
  sex: { male: number; female: number };
  ageBuckets: Array<{ label: string; range: string; count: number }>;
  prescriptionTypes: Array<{ type: string; count: number }>;
  total: number;
};

export type ThemeCandidate = {
  theme: string;
  count: number;
  rate: number;
  caseNumbers: number[];
};

/** Theme promoted from candidate to final by Stage 1. */
export type ResolvedTheme = ThemeCandidate;

/** Gap confirmed by dual-evidence rule (inputRate < 70% AND aiAskRate >= 30%). */
export type GapCandidate = {
  field: FieldCompletenessStat["field"];
  label: string;
  inputRate: number;
  aiAskRate: number;
  caseNumbers: number[];
};

/** Strength signal detected deterministically. */
export type StrengthSignal = {
  kind: string;
  description: string;
  rate?: number;
  count?: number;
  caseNumbers: number[];
};

/** Output of Stage 1 — all structural findings, no prose. */
export type EvaluationFindings = {
  fieldCompleteness: FieldCompletenessStat[];
  patientDistribution: PatientDistribution;
  aiRecurringThemes: ResolvedTheme[];
  gapCandidates: GapCandidate[];
  strengthSignals: StrengthSignal[];
  sampleCases: EvalRow[];
  totalCount: number;
};

/** Narrative output of Stage 2 — prose only, no structural decisions. */
type EvalNarrative = {
  profileSummary: string;
  keyObservations: string[];
  strengths: Array<{ text: string }>;
  gapsNarrative: Array<{
    field: string;
    evidence: string;
    guidanceHint: string;
  }>;
  guidancePoints: Array<{ text: string }>;
};

export type DoctorProfile = {
  profileSummary: string;
  keyObservations: string[];
  patientDistribution: PatientDistribution | null;
  /** Kept in DB for gap detection and backward compat; not rendered in UI. */
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
  strengths: Array<{ text: string }>;
  gaps: Array<{
    field: string;
    inputRate: number;
    aiAskRate: number;
    evidence: string;
    caseNumbers: number[];
    guidanceHint: string;
  }>;
  guidancePoints: Array<{ text: string }>;
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
// Constants
// ---------------------------------------------------------------------------

const MAX_EVAL_CASES = 20;
const MAX_THEMES = 5;
const GAP_INPUT_THRESHOLD = 0.7;
const GAP_AI_ASK_THRESHOLD = 0.3;
const STRENGTH_COMPLETENESS_THRESHOLD = 0.9;
const STRENGTH_TONGUE_PULSE_THRESHOLD = 0.8;
const STRENGTH_PRESCRIPTION_DETAIL_THRESHOLD = 0.5;
const STRENGTH_COMPLAINT_LENGTH_THRESHOLD = 15;
const STRENGTH_PATTERN_DIVERSITY_MIN = 5;

const FIELD_LABELS: Record<FieldCompletenessStat["field"], string> = {
  pastHistory: "既往史",
  physicalExam: "体格检查",
};

/**
 * Maps each trackable field to the AI theme that signals the field is missing.
 * Only fields with a corresponding theme can be detected as gaps.
 */
const FIELD_TO_THEME: Partial<Record<FieldCompletenessStat["field"], string>> = {
  pastHistory: "既往史补充",
  physicalExam: "体格检查补充",
};

const AGE_BUCKETS = [
  { label: "儿童", range: "≤14", min: 0, max: 14 },
  { label: "青年", range: "15–39", min: 15, max: 39 },
  { label: "中年", range: "40–64", min: 40, max: 64 },
  { label: "老年", range: "≥65", min: 65, max: 999 },
] as const;

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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isFilled(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return stringValue(value).length > 0;
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

// ---------------------------------------------------------------------------
// Compact case serialization — used by sessionReview.ts (Goal 1)
// ---------------------------------------------------------------------------

function cell(s: string, max: number): string {
  return truncate(s.replace(/[|\n\r]/g, " ").trim(), max);
}

function joinArray(arr: unknown, max = 1, sep = "；"): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, max)
    .join(sep);
}

export function serializeConsultationsCompact(
  rows: Array<{ form_data: Record<string, unknown> | null; analysis_result: Record<string, unknown> | null }>,
): string {
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

// ---------------------------------------------------------------------------
// Stage 1 — Observer (exported for testing)
// ---------------------------------------------------------------------------

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
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
}

function detectGaps(
  fieldCompleteness: FieldCompletenessStat[],
  sampleCases: EvalRow[],
): GapCandidate[] {
  const sampleCount = sampleCases.length;
  const themeCandidates = extractThemeCandidates(sampleCases);
  const themeByName = new Map(themeCandidates.map((t) => [t.theme, t]));

  return fieldCompleteness.flatMap((stat) => {
    if (stat.rate >= GAP_INPUT_THRESHOLD) return [];
    const themeName = FIELD_TO_THEME[stat.field];
    if (!themeName) return [];
    const theme = themeByName.get(themeName);
    if (!theme) return [];
    const aiAskRate = sampleCount > 0 ? theme.count / sampleCount : 0;
    if (aiAskRate < GAP_AI_ASK_THRESHOLD) return [];
    return [
      {
        field: stat.field,
        label: stat.label,
        inputRate: stat.rate,
        aiAskRate,
        caseNumbers: theme.caseNumbers,
      },
    ];
  });
}

export function computePatientDistribution(rows: EvalRow[]): PatientDistribution {
  const total = rows.length;
  const male = rows.filter((r) => r.form_data?.patientSex === "男").length;
  const female = rows.filter((r) => r.form_data?.patientSex === "女").length;

  const ageBuckets = AGE_BUCKETS.map((b) => ({
    label: b.label,
    range: b.range,
    count: rows.filter((r) => {
      const age = parseInt(String(r.form_data?.patientAge ?? ""), 10);
      return !isNaN(age) && age >= b.min && age <= b.max;
    }).length,
  }));

  const typeCount = new Map<string, number>();
  for (const row of rows) {
    const types = Array.isArray(row.form_data?.prescriptionType)
      ? (row.form_data!.prescriptionType as string[])
      : [String(row.form_data?.prescriptionType ?? "其他")];
    for (const t of types) {
      typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
    }
  }
  const prescriptionTypes = [...typeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return { sex: { male, female }, ageBuckets, prescriptionTypes, total };
}

function detectStrengthSignals(
  fieldCompleteness: FieldCompletenessStat[],
  sampleCases: EvalRow[],
): StrengthSignal[] {
  const signals: StrengthSignal[] = [];
  const n = sampleCases.length;

  // High field completeness (≥90%)
  for (const stat of fieldCompleteness) {
    if (stat.rate >= STRENGTH_COMPLETENESS_THRESHOLD && stat.filled >= 2) {
      signals.push({
        kind: "high_completeness",
        description: `${stat.label}填写率${Math.round(stat.rate * 100)}%`,
        rate: stat.rate,
        caseNumbers: sampleCases
          .map((row, i) => ({ filled: isFilled(row.form_data?.[stat.field]), num: i + 1 }))
          .filter((c) => c.filled)
          .map((c) => c.num)
          .slice(0, 5),
      });
    }
  }

  // Tongue/pulse consistency — 舌脉 mentioned in physicalExam
  const tonguePulseCases = sampleCases
    .map((r, i) => ({ has: /[舌脉]/.test(String(r.form_data?.physicalExam ?? "")), num: i + 1 }))
    .filter((c) => c.has);
  const tpRate = n > 0 ? tonguePulseCases.length / n : 0;
  if (tpRate >= STRENGTH_TONGUE_PULSE_THRESHOLD) {
    signals.push({
      kind: "tongue_pulse_consistency",
      description: `舌脉记录一致性${Math.round(tpRate * 100)}%`,
      rate: tpRate,
      caseNumbers: tonguePulseCases.map((c) => c.num).slice(0, 5),
    });
  }

  // Pattern diversity — distinct 证型 count
  const distinctPatterns = new Set(
    sampleCases.map((r) => String(r.form_data?.pattern ?? "").trim()).filter(Boolean),
  );
  if (distinctPatterns.size >= STRENGTH_PATTERN_DIVERSITY_MIN) {
    signals.push({
      kind: "pattern_diversity",
      description: `证型多样性：${distinctPatterns.size}种不同证型`,
      count: distinctPatterns.size,
      caseNumbers: [],
    });
  }

  // Detailed prescription — dosage markers present
  const DOSAGE_PATTERN = /\d+\s*[克gG两钱]/;
  const detailedCases = sampleCases
    .map((r, i) => ({ has: DOSAGE_PATTERN.test(String(r.form_data?.prescription ?? "")), num: i + 1 }))
    .filter((c) => c.has);
  const detailRate = n > 0 ? detailedCases.length / n : 0;
  if (detailRate >= STRENGTH_PRESCRIPTION_DETAIL_THRESHOLD) {
    signals.push({
      kind: "detailed_prescription",
      description: `${Math.round(detailRate * 100)}%的处方含明确剂量标注`,
      rate: detailRate,
      caseNumbers: detailedCases.map((c) => c.num).slice(0, 5),
    });
  }

  // Chief complaint specificity — average length
  if (n > 0) {
    const lengths = sampleCases.map((r) => String(r.form_data?.chiefComplaint ?? "").length);
    const avg = lengths.reduce((a, b) => a + b, 0) / n;
    if (avg >= STRENGTH_COMPLAINT_LENGTH_THRESHOLD) {
      signals.push({
        kind: "chief_complaint_specificity",
        description: `主诉平均长度${Math.round(avg)}字，描述具体`,
        count: Math.round(avg),
        caseNumbers: [],
      });
    }
  }

  return signals;
}

/** Stage 1 entry point — deterministic, no LLM. */
export function analyzeConsultations(rows: EvalRow[]): EvaluationFindings {
  const sampleCases = sampleRecentCases(rows);
  const fieldCompleteness = computeFieldCompleteness(rows);
  const patientDistribution = computePatientDistribution(rows);
  const themeCandidates = extractThemeCandidates(sampleCases);
  const aiRecurringThemes = themeCandidates.slice(0, MAX_THEMES);
  const gapCandidates = detectGaps(fieldCompleteness, sampleCases);
  const strengthSignals = detectStrengthSignals(fieldCompleteness, sampleCases);

  return {
    fieldCompleteness,
    patientDistribution,
    aiRecurringThemes,
    gapCandidates,
    strengthSignals,
    sampleCases,
    totalCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — Narrator
// ---------------------------------------------------------------------------

/** Compact serialization of Stage 1 findings sent to the LLM. */
function serializeFindings(findings: EvaluationFindings, windowDays: number): string {
  const { fieldCompleteness, patientDistribution, aiRecurringThemes, gapCandidates, strengthSignals, sampleCases, totalCount } = findings;
  const n = sampleCases.length;
  const pd = patientDistribution;

  const lines: string[] = [
    `窗口：过去 ${windowDays} 天（共 ${totalCount} 条，分层取样 ${n} 条）`,
    "",
    "PATIENT_DISTRIBUTION",
    `性别: 男${pd.sex.male} / 女${pd.sex.female}`,
    `年龄: ${pd.ageBuckets.map((b) => `${b.label}${b.count}`).join(" / ")}`,
    `处方类型: ${pd.prescriptionTypes.map((p) => `${p.type}${p.count}`).join(" / ")}`,
    "",
    "DETERMINISTIC_FIELD_COMPLETENESS",
    ...fieldCompleteness.map(
      (s) => `${s.field}/${s.label}: ${s.filled}/${s.total} (${Math.round(s.rate * 100)}%)`,
    ),
    "",
    "DETERMINISTIC_AI_RECURRING_THEMES",
    ...(aiRecurringThemes.length > 0
      ? aiRecurringThemes.map(
          (t) => `${t.theme}: ${t.count}/${n} (${Math.round(t.rate * 100)}%) cases=${t.caseNumbers.join(",")}`,
        )
      : ["none"]),
    "",
    "DETERMINISTIC_GAP_CANDIDATES (inputRate<70% 且 aiAskRate>=30%，双证据规则已在代码中应用)",
    ...(gapCandidates.length > 0
      ? gapCandidates.map(
          (g) =>
            `${g.field}/${g.label}: inputRate=${Math.round(g.inputRate * 100)}%, aiAskRate=${Math.round(g.aiAskRate * 100)}%, cases=${g.caseNumbers.join(",")}`,
        )
      : ["none"]),
    "",
    "DETERMINISTIC_STRENGTH_SIGNALS",
    ...(strengthSignals.length > 0
      ? strengthSignals.map((s) =>
          s.caseNumbers.length > 0
            ? `${s.kind}: ${s.description}, cases=${s.caseNumbers.join(",")}`
            : `${s.kind}: ${s.description}`,
        )
      : ["none"]),
    "",
    "CASE_EXCERPTS (仅用于引用案例编号，不要重新分析临床内容)",
    ...sampleCases.map((row, i) => {
      const fd = row.form_data ?? {};
      return [
        `#${i + 1}`,
        `${fd.patientSex ?? "?"}/${fd.patientAge ?? "?"}岁`,
        truncate(String(fd.chiefComplaint ?? ""), 30),
        `诊断:${truncate(String(fd.diagnosis ?? ""), 20)}`,
        `证型:${truncate(String(fd.pattern ?? ""), 20)}`,
      ].join(" ");
    }),
  ];

  return lines.join("\n");
}

/** Merges Stage 1 structural findings with Stage 2 prose into a DoctorProfile. */
function mergeProfile(findings: EvaluationFindings, narrative: EvalNarrative): DoctorProfile {
  const { fieldCompleteness, patientDistribution, aiRecurringThemes, gapCandidates, sampleCases } = findings;
  const n = sampleCases.length;

  const resolvedThemes = aiRecurringThemes.map((t) => ({
    theme: t.theme,
    frequency: `${t.count}/${n} (${Math.round(t.rate * 100)}%)`,
    caseNumbers: t.caseNumbers,
  }));

  const narrativeByField = new Map(
    (narrative.gapsNarrative ?? []).map((g) => [g.field, g]),
  );

  const gaps = gapCandidates.map((gc) => {
    const gn = narrativeByField.get(gc.field);
    return {
      field: gc.field,
      inputRate: gc.inputRate,
      aiAskRate: gc.aiAskRate,
      evidence:
        gn?.evidence ??
        `${gc.label}填写率为 ${Math.round(gc.inputRate * 100)}%，AI 在 ${Math.round(gc.aiAskRate * 100)}% 的样本中提醒补充。`,
      caseNumbers: gc.caseNumbers,
      guidanceHint: gn?.guidanceHint ?? "",
    };
  });

  return {
    profileSummary: narrative.profileSummary || "暂无可展示的画像摘要。",
    keyObservations: narrative.keyObservations ?? [],
    patientDistribution,
    fieldCompleteness,
    aiRecurringThemes: resolvedThemes,
    strengths: (narrative.strengths ?? []).map((s) => ({ text: s.text })),
    gaps,
    guidancePoints: (narrative.guidancePoints ?? []).map((g) => ({ text: g.text })),
  };
}

/** Stage 2 entry point — LLM narration only. */
async function narrateFindings(
  findings: EvaluationFindings,
  windowDays: number,
  langfuse: ReturnType<typeof getLangfuse>,
  trace: { generation: (args: unknown) => void } | undefined,
): Promise<EvalNarrative> {
  const model = getDeepSeekFastModel();
  const userPrompt = serializeFindings(findings, windowDays);

  const callStartedAt = Date.now();
  const result = await callDeepSeekJson<EvalNarrative>({
    messages: [
      { role: "system", content: DOCTOR_EVALUATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model,
    maxTokens: 2500,
    timeoutMs: 90_000,
    repairJson: true,
    retryOnEmpty: true,
    jsonMode: false,
  });

  if (langfuse && trace) {
    trace.generation({
      name: "deepseek-narrate",
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
        windowDays,
        totalCount: findings.totalCount,
        sampledCount: findings.sampleCases.length,
      },
    });
    try {
      await langfuse.flushAsync();
    } catch {
      /* non-critical */
    }
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Backward-compat normalization (for old DB records)
// ---------------------------------------------------------------------------

export function normalizeDoctorProfile(value: unknown): DoctorProfile {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const listObjects = <T>(key: string): T[] =>
    Array.isArray(raw[key]) ? (raw[key] as T[]) : [];
  const textList = (key: string): string[] =>
    Array.isArray(raw[key])
      ? (raw[key] as unknown[]).filter((item): item is string => typeof item === "string")
      : [];

  const guidancePoints = Array.isArray(raw.guidancePoints)
    ? (raw.guidancePoints as unknown[]).filter(
        (item): item is DoctorProfile["guidancePoints"][number] =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).text === "string",
      )
    : [];
  const oldGuidance = textList("guidancePoints").map((text) => ({ text, caseNumbers: [] }));

  const rawGaps = Array.isArray(raw.gaps) ? (raw.gaps as Array<Record<string, unknown>>) : [];
  const v11Gaps = rawGaps
    .filter((gap) => "field" in gap || "inputRate" in gap || "aiAskRate" in gap || "evidence" in gap)
    .map((gap) => gap as DoctorProfile["gaps"][number]);
  const oldGaps = rawGaps
    .filter(
      (gap) => !("field" in gap || "inputRate" in gap || "aiAskRate" in gap || "evidence" in gap),
    )
    .map((gap) => ({
      field: stringValue(gap.gap) || "legacy",
      inputRate: 0,
      aiAskRate: 0,
      evidence: stringValue(gap.frequency),
      caseNumbers: [],
      guidanceHint: stringValue(gap.guidanceHint),
    }));

  const keyObservations = Array.isArray(raw.keyObservations)
    ? (raw.keyObservations as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  return {
    profileSummary: stringValue(raw.profileSummary) || "暂无可展示的画像摘要。",
    keyObservations,
    patientDistribution: (raw.patientDistribution as PatientDistribution | null) ?? null,
    fieldCompleteness: listObjects<DoctorProfile["fieldCompleteness"][number]>("fieldCompleteness"),
    aiRecurringThemes: listObjects<DoctorProfile["aiRecurringThemes"][number]>("aiRecurringThemes"),
    strengths: listObjects<DoctorProfile["strengths"][number]>("strengths"),
    gaps: v11Gaps.length ? v11Gaps : oldGaps,
    guidancePoints: guidancePoints.length ? guidancePoints : oldGuidance,
  };
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
  if (rows.length === 0) throw new NoConsultationsError(windowDays);

  // Stage 1: deterministic observer — no LLM
  const findings = analyzeConsultations(rows);

  // Stage 2: LLM narrator — prose only
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "evaluate-doctor",
    metadata: {
      doctorId,
      windowDays,
      consultationCount: rows.length,
      sampledCount: findings.sampleCases.length,
    },
  }) as { generation: (args: unknown) => void } | undefined;

  const narrative = await narrateFindings(findings, windowDays, langfuse, trace);

  // Merge structural findings + prose into final profile
  const doctorProfile = mergeProfile(findings, narrative);

  return {
    evaluation: { doctorProfile },
    consultationCount: rows.length,
    model: getDeepSeekFastModel(),
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
