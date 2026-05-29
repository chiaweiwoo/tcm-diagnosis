/**
 * Doctor Profile Snapshot — deterministic metrics computed from analysis_result JSONB.
 * No AI calls, no writes. Pure read + aggregate.
 *
 * Metrics:
 *   Quality signals  — criticalRisk触发率, nonClinical出现率, 风险有实质内容率
 *   AI response depth — per-section mean item count + zero-count rate
 *   Input completeness — per-field average character count
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAnalysisResult } from "@/lib/ai/analysisResult";

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
