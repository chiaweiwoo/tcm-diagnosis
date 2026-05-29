/**
 * Doctor Profile Snapshot — metrics and flagged cases for admin audit.
 *
 * computeDoctorProfile — deterministic aggregates (rates, section depths, field lengths)
 * findFlaggedCases     — actionable case list: boolean signals + percentile tails + LLM clustering
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAnalysisResult } from "@/lib/ai/analysisResult";
import { clusterPrescriptions, type PrescriptionCluster } from "./clusterPrescriptions";

export const LOW_SAMPLE_THRESHOLD = 20;

const FALLBACK_CAUTIONS = "请结合面诊与必要检查复核后执行。";

export type SectionMetric = {
  sectionTitle: string;
  groupTitle: string | null;
  mean: number;
  zeroRate: number; // fraction 0-1
};

export type FieldMetric = {
  field: string;
  label: string;
  avgChars: number;
};

export type DoctorProfileSnapshot = {
  doctorId: string;
  totalAnalyzed: number;
  oldestAnalyzedAt: string | null;
  latestAnalyzedAt: string | null;
  computedAt: string;
  criticalRiskRate: number; // fraction 0-1
  nonClinicalRate: number;  // fraction 0-1
  realCautionsRate: number; // fraction 0-1 (cases with real, non-fallback cautions)
  sections: SectionMetric[];
  fields: FieldMetric[];
};

// ─── Types for flagged cases ──────────────────────────────────────────────────

export type RuleKey =
  | "criticalRisk"
  | "nonClinical"
  | "needsReviewHigh"
  | "physicalExamShort"
  | "currentIllnessShort";

const RULE_LABELS: Record<RuleKey, string> = {
  criticalRisk: "AI 触发辨证警示",
  nonClinical: "非临床信息混入",
  needsReviewHigh: "需要复核 项目偏多",
  physicalExamShort: "体查记录偏短",
  currentIllnessShort: "现病史记录偏短",
};

// Priority order for deduplication — first rule wins
const RULE_PRIORITY: RuleKey[] = [
  "criticalRisk",
  "nonClinical",
  "needsReviewHigh",
  "physicalExamShort",
  "currentIllnessShort",
];

const RULE_CAPS: Record<RuleKey, number> = {
  criticalRisk: 10,
  nonClinical: 5,
  needsReviewHigh: 10,
  physicalExamShort: 5,
  currentIllnessShort: 5,
};

export type FlaggedCase = {
  id: string;
  displayName: string;
  date: string;
  ruleKey: RuleKey;
  ruleLabel: string;
  evidence: string;
};

export type FlaggedCasesResult = {
  flagged: FlaggedCase[];
  clusters: PrescriptionCluster[];
};

// Re-export so callers don't need to import from clusterPrescriptions directly
export type { PrescriptionCluster };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function computeMean(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 10) / 10;
}

export function computeZeroRate(nums: number[]): number {
  if (nums.length === 0) return 0;
  const zeros = nums.filter((n) => n === 0).length;
  return Math.round((zeros / nums.length) * 1000) / 1000;
}

export function isCautionsFallbackOnly(cautions: string[]): boolean {
  return cautions.length === 1 && cautions[0] === FALLBACK_CAUTIONS;
}

/** Linear-interpolated percentile. p is 0–100. */
export function computePercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

// ─── Main compute ─────────────────────────────────────────────────────────────

export async function computeDoctorProfile(
  client: SupabaseClient,
  doctorId: string,
): Promise<DoctorProfileSnapshot> {
  const { data, error } = await client
    .from("consultations")
    .select("analysis_result, form_data, analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .order("analyzed_at", { ascending: true });

  if (error) {
    throw new Error(`computeDoctorProfile: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    analysis_result: unknown;
    form_data: unknown;
    analyzed_at: string;
  }>;

  const totalAnalyzed = rows.length;
  const oldestAnalyzedAt = rows.length > 0 ? rows[0].analyzed_at : null;
  const latestAnalyzedAt = rows.length > 0 ? rows[rows.length - 1].analyzed_at : null;

  let criticalRiskCount = 0;
  let nonClinicalCount = 0;
  let realCautionsCount = 0;

  const counts = {
    建议优化: [] as number[],
    可选思路: [] as number[],
    可取之处: [] as number[],
    需要复核: [] as number[],
    风险与提醒: [] as number[],
    随访监测: [] as number[],
  };

  const charCounts = {
    chiefComplaint: [] as number[],
    currentIllness: [] as number[],
    pastHistory: [] as number[],
    physicalExam: [] as number[],
    diagnosis: [] as number[],
    pattern: [] as number[],
    prescription: [] as number[],
  };

  for (const row of rows) {
    const ar = ensureAnalysisResult(row.analysis_result);
    const fd = (row.form_data as Record<string, unknown> | null) ?? {};

    if (ar) {
      if (ar.criticalRisk !== null) criticalRiskCount++;
      if (ar.nonClinical.length > 0) nonClinicalCount++;

      const cautionsFallback = isCautionsFallbackOnly(ar.cautions);
      if (!cautionsFallback) realCautionsCount++;
      counts["风险与提醒"].push(cautionsFallback ? 0 : ar.cautions.length);

      const judgeGroup = ar.groups.find((g) => g.title === "判断");
      const planGroup = ar.groups.find((g) => g.title === "方案");
      const followGroup = ar.groups.find((g) => g.title === "随访监测");

      counts["可取之处"].push(
        judgeGroup?.sections.find((s) => s.title === "可取之处")?.items.length ?? 0,
      );
      counts["需要复核"].push(
        judgeGroup?.sections.find((s) => s.title === "需要复核")?.items.length ?? 0,
      );
      counts["建议优化"].push(
        planGroup?.sections.find((s) => s.title === "建议优化")?.items.length ?? 0,
      );
      counts["可选思路"].push(
        planGroup?.sections.find((s) => s.title === "可选思路")?.items.length ?? 0,
      );
      counts["随访监测"].push(
        followGroup?.sections.find((s) => s.title === "随访监测")?.items.length ?? 0,
      );
    }

    for (const key of Object.keys(charCounts) as (keyof typeof charCounts)[]) {
      const val = fd[key];
      charCounts[key].push(typeof val === "string" ? val.length : 0);
    }
  }

  const SECTION_DEFS: Array<{ key: keyof typeof counts; groupTitle: string | null }> = [
    { key: "建议优化", groupTitle: "方案" },
    { key: "可选思路", groupTitle: "方案" },
    { key: "可取之处", groupTitle: "判断" },
    { key: "需要复核", groupTitle: "判断" },
    { key: "风险与提醒", groupTitle: null },
    { key: "随访监测", groupTitle: "随访监测" },
  ];

  const sections: SectionMetric[] = SECTION_DEFS.map(({ key, groupTitle }) => ({
    sectionTitle: key,
    groupTitle,
    mean: computeMean(counts[key]),
    zeroRate: computeZeroRate(counts[key]),
  }));

  const FIELD_LABELS: Record<string, string> = {
    chiefComplaint: "主诉",
    currentIllness: "现病史",
    pastHistory: "既往史",
    physicalExam: "体查（舌脉）",
    diagnosis: "诊断",
    pattern: "证型",
    prescription: "处方",
  };

  const fields: FieldMetric[] = Object.entries(charCounts).map(([field, chars]) => ({
    field,
    label: FIELD_LABELS[field] ?? field,
    avgChars: computeMean(chars),
  }));

  const rate = (n: number) =>
    totalAnalyzed > 0 ? Math.round((n / totalAnalyzed) * 1000) / 1000 : 0;

  return {
    doctorId,
    totalAnalyzed,
    oldestAnalyzedAt,
    latestAnalyzedAt,
    computedAt: new Date().toISOString(),
    criticalRiskRate: rate(criticalRiskCount),
    nonClinicalRate: rate(nonClinicalCount),
    realCautionsRate: rate(realCautionsCount),
    sections,
    fields,
  };
}

// ─── Flagged cases ────────────────────────────────────────────────────────────

type FullRow = {
  id: string;
  analysis_result: unknown;
  form_data: unknown;
  analyzed_at: string;
};

function buildDisplayName(fd: Record<string, unknown> | null): string {
  if (!fd) return "未命名病案";
  const parts = [
    fd.patientSex,
    fd.patientAge ? `${fd.patientAge}岁` : null,
    fd.chiefComplaint || null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" ") : "未命名病案";
}

function formatSGT(iso: string): string {
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Find cases worth reviewing for a given doctor.
 *
 * Rules (priority order, each case counted once):
 *   1. criticalRisk fired        (boolean, always)
 *   2. nonClinical present       (boolean, always)
 *   3. 需要复核 items > P90      (within-doctor, N ≥ 20)
 *   4. physicalExam chars < P10  (within-doctor, N ≥ 20)
 *   5. currentIllness chars < P10 (within-doctor, N ≥ 20)
 *   + LLM prescription clusters  (N ≥ 20, returned separately)
 */
export async function findFlaggedCases(
  client: SupabaseClient,
  doctorId: string,
): Promise<FlaggedCasesResult> {
  const { data, error } = await client
    .from("consultations")
    .select("id, analysis_result, form_data, analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .order("analyzed_at", { ascending: false }); // newest first for capping

  if (error) {
    throw new Error(`findFlaggedCases: ${error.message}`);
  }

  const rows = (data ?? []) as FullRow[];
  const n = rows.length;

  if (n === 0) return { flagged: [], clusters: [] };

  // Pre-compute percentile thresholds when N is large enough
  let needsReviewP90 = Infinity;
  let physicalExamP10 = 0;
  let currentIllnessP10 = 0;

  if (n >= LOW_SAMPLE_THRESHOLD) {
    const needsReviewCounts: number[] = [];
    const physicalExamChars: number[] = [];
    const currentIllnessChars: number[] = [];

    for (const row of rows) {
      const ar = ensureAnalysisResult(row.analysis_result);
      const fd = (row.form_data as Record<string, unknown> | null) ?? {};

      if (ar) {
        const judgeGroup = ar.groups.find((g) => g.title === "判断");
        needsReviewCounts.push(
          judgeGroup?.sections.find((s) => s.title === "需要复核")?.items.length ?? 0,
        );
      }

      physicalExamChars.push(typeof fd.physicalExam === "string" ? fd.physicalExam.length : 0);
      currentIllnessChars.push(
        typeof fd.currentIllness === "string" ? fd.currentIllness.length : 0,
      );
    }

    needsReviewP90 = computePercentile(needsReviewCounts, 90);
    physicalExamP10 = computePercentile(physicalExamChars, 10);
    currentIllnessP10 = computePercentile(currentIllnessChars, 10);
  }

  // Build flagged list — deduplicate by case ID, cap per rule
  const usedIds = new Set<string>();
  const buckets = new Map<RuleKey, FlaggedCase[]>(RULE_PRIORITY.map((k) => [k, []]));

  for (const row of rows) {
    if (usedIds.has(row.id)) continue;

    const ar = ensureAnalysisResult(row.analysis_result);
    const fd = (row.form_data as Record<string, unknown> | null) ?? {};
    const displayName = buildDisplayName(fd);
    const date = formatSGT(row.analyzed_at);

    let matchedRule: RuleKey | null = null;
    let evidence = "";

    // Rule 1
    if (!matchedRule && ar?.criticalRisk) {
      const bucket = buckets.get("criticalRisk")!;
      if (bucket.length < RULE_CAPS.criticalRisk) {
        matchedRule = "criticalRisk";
        evidence = ar.criticalRisk.summary.slice(0, 50);
      }
    }

    // Rule 2
    if (!matchedRule && ar && ar.nonClinical.length > 0) {
      const bucket = buckets.get("nonClinical")!;
      if (bucket.length < RULE_CAPS.nonClinical) {
        matchedRule = "nonClinical";
        evidence = ar.nonClinical[0].slice(0, 40);
      }
    }

    // Rule 3 (percentile — only when N ≥ threshold)
    if (!matchedRule && n >= LOW_SAMPLE_THRESHOLD && ar) {
      const judgeGroup = ar.groups.find((g) => g.title === "判断");
      const count =
        judgeGroup?.sections.find((s) => s.title === "需要复核")?.items.length ?? 0;
      const bucket = buckets.get("needsReviewHigh")!;
      if (count > needsReviewP90 && bucket.length < RULE_CAPS.needsReviewHigh) {
        matchedRule = "needsReviewHigh";
        evidence = `需要复核 ${count} 项`;
      }
    }

    // Rule 4
    if (!matchedRule && n >= LOW_SAMPLE_THRESHOLD) {
      const len = typeof fd.physicalExam === "string" ? fd.physicalExam.length : 0;
      const bucket = buckets.get("physicalExamShort")!;
      if (len < physicalExamP10 && bucket.length < RULE_CAPS.physicalExamShort) {
        matchedRule = "physicalExamShort";
        evidence = `体查 ${len} 字`;
      }
    }

    // Rule 5
    if (!matchedRule && n >= LOW_SAMPLE_THRESHOLD) {
      const len = typeof fd.currentIllness === "string" ? fd.currentIllness.length : 0;
      const bucket = buckets.get("currentIllnessShort")!;
      if (len < currentIllnessP10 && bucket.length < RULE_CAPS.currentIllnessShort) {
        matchedRule = "currentIllnessShort";
        evidence = `现病史 ${len} 字`;
      }
    }

    if (matchedRule) {
      usedIds.add(row.id);
      buckets.get(matchedRule)!.push({
        id: row.id,
        displayName,
        date,
        ruleKey: matchedRule,
        ruleLabel: RULE_LABELS[matchedRule],
        evidence,
      });
    }
  }

  const flagged = RULE_PRIORITY.flatMap((k) => buckets.get(k)!);

  // LLM clustering — only when N is large enough
  let clusters: PrescriptionCluster[] = [];
  if (n >= LOW_SAMPLE_THRESHOLD) {
    const clusterInput = rows
      .slice(0, 60)
      .map((row) => {
        const fd = (row.form_data as Record<string, unknown> | null) ?? {};
        return {
          id: row.id,
          diagnosis: String(fd.diagnosis ?? "").trim(),
          pattern: String(fd.pattern ?? "").trim(),
          prescription: String(fd.prescription ?? "").trim(),
        };
      })
      .filter((c) => c.prescription.length > 0);

    clusters = await clusterPrescriptions(clusterInput);
  }

  return { flagged, clusters };
}
