/**
 * Analytics stats computation — Sprint 4 (stats stage, no LLM).
 *
 * Three exported functions:
 *   computePromptQualityStats  — global, window defaults to last 7 days
 *   computeUsageStats          — per-doctor, window defaults to last 30 days
 *   computePerformanceStats    — per-doctor, window defaults to last 30 days
 *
 * All functions fetch raw consultation rows and compute in TypeScript.
 * Dataset is small in the pilot so this is acceptable. Migrate to SQL
 * aggregations if doctor count or consultation volume grows significantly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Exported stat types
// ---------------------------------------------------------------------------

export type PromptQualityStats = {
  consultationCount: number;
  repairedJsonRate: number;
  riskFlagRate: number;
  avgDurationSeconds: number | null;
  prescriptionTypeDist: Record<string, number>;
  sectionCoverage: {
    keyPoints: number;
    cautions: number;
    evidence: number;
    column0: number;
    column1: number;
    column2: number;
  };
};

export type UsageStats = {
  consultationCount: number;
  activeDays: number;
  avgPerActiveDay: number;
  prescriptionTypeDist: Record<string, number>;
  topDiagnoses: Array<{ value: string; count: number }>;
  topComplaints: Array<{ value: string; count: number }>;
};

export type PerformanceStats = {
  avgLengthPerField: Record<string, number>;
  repairedJsonRate: number;
  riskFlagRate: number;
  topDiagnosisPatternPairs: Array<{ diagnosis: string; pattern: string; count: number }>;
};

// ---------------------------------------------------------------------------
// Internal row types (loosely typed JSONB fields)
// ---------------------------------------------------------------------------

type AnalysisRow = {
  doctor_id: string;
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  model_meta: Record<string, unknown> | null;
  analyzed_at: string | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNonEmptyArray(val: unknown): boolean {
  return Array.isArray(val) && val.length > 0;
}

function coverageRate(rows: AnalysisRow[], predicate: (r: AnalysisRow) => boolean): number {
  if (!rows.length) return 0;
  return rows.filter(predicate).length / rows.length;
}

function getPrescriptionTypes(formData: Record<string, unknown> | null): string[] {
  if (!formData) return [];
  const pt = formData.prescriptionType;
  if (Array.isArray(pt)) return pt.map(String);
  if (typeof pt === "string" && pt) return [pt];
  return [];
}

function topN<T extends string>(
  rows: AnalysisRow[],
  extractor: (r: AnalysisRow) => T | null | undefined,
  n = 10,
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const val = extractor(row);
    if (val) {
      const key = String(val).slice(0, 20); // cap length for grouping
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function avgLength(rows: AnalysisRow[], field: string): number {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, r) => {
    const v = r.form_data?.[field];
    return sum + (typeof v === "string" ? v.length : 0);
  }, 0);
  return Math.round(total / rows.length);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchConsultations(
  client: SupabaseClient,
  windowStart: Date,
  windowEnd: Date,
  doctorId?: string,
): Promise<AnalysisRow[]> {
  let q = client
    .from("consultations")
    .select("doctor_id,form_data,analysis_result,model_meta,analyzed_at")
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lt("analyzed_at", windowEnd.toISOString());

  if (doctorId) q = q.eq("doctor_id", doctorId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AnalysisRow[];
}

// ---------------------------------------------------------------------------
// Window builders
// ---------------------------------------------------------------------------

export function buildWindow(days: number): { windowStart: Date; windowEnd: Date } {
  // windowEnd = start of tomorrow so today's records are always included in the window
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 1);
  windowEnd.setHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - days);
  return { windowStart, windowEnd };
}

// ---------------------------------------------------------------------------
// Stat functions
// ---------------------------------------------------------------------------

/**
 * Global prompt quality stats — runs over ALL doctors' analyzed consultations
 * in the given window. Default: last 7 days.
 */
export async function computePromptQualityStats(
  client: SupabaseClient,
  windowStart: Date,
  windowEnd: Date,
): Promise<PromptQualityStats> {
  const rows = await fetchConsultations(client, windowStart, windowEnd);

  const consultationCount = rows.length;

  if (consultationCount === 0) {
    return {
      consultationCount: 0,
      repairedJsonRate: 0,
      riskFlagRate: 0,
      avgDurationSeconds: null,
      prescriptionTypeDist: {},
      sectionCoverage: { keyPoints: 0, cautions: 0, evidence: 0, column0: 0, column1: 0, column2: 0 },
    };
  }

  // repairedJsonRate
  const repairedJsonRate = coverageRate(
    rows,
    (r) => r.model_meta?.repairedJson === true,
  );

  // riskFlagRate
  const riskFlagRate = coverageRate(
    rows,
    (r) => isNonEmptyArray((r.analysis_result as Record<string, unknown> | null)?.cautions),
  );

  // avgDurationSeconds
  const durations = rows
    .map((r) => {
      const d = r.model_meta?.durationSeconds;
      return typeof d === "number" ? d : null;
    })
    .filter((d): d is number => d !== null);
  const avgDurationSeconds =
    durations.length > 0
      ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
      : null;

  // prescriptionTypeDist
  const typeDist: Record<string, number> = {};
  for (const row of rows) {
    for (const pt of getPrescriptionTypes(row.form_data)) {
      typeDist[pt] = (typeDist[pt] ?? 0) + 1;
    }
  }

  // sectionCoverage
  const ar = (r: AnalysisRow) => r.analysis_result as Record<string, unknown> | null;
  const sectionCoverage = {
    keyPoints: coverageRate(rows, (r) => isNonEmptyArray(ar(r)?.keyPoints)),
    cautions: coverageRate(rows, (r) => isNonEmptyArray(ar(r)?.cautions)),
    evidence: coverageRate(rows, (r) => isNonEmptyArray(ar(r)?.evidence)),
    column0: coverageRate(rows, (r) => {
      const groups = ar(r)?.groups as Array<{ sections?: Array<{ content?: unknown[] }> }> | undefined;
      return isNonEmptyArray(groups?.[0]?.sections);
    }),
    column1: coverageRate(rows, (r) => {
      const groups = ar(r)?.groups as Array<{ sections?: Array<{ content?: unknown[] }> }> | undefined;
      return isNonEmptyArray(groups?.[1]?.sections);
    }),
    column2: coverageRate(rows, (r) => {
      const groups = ar(r)?.groups as Array<{ sections?: Array<{ content?: unknown[] }> }> | undefined;
      return isNonEmptyArray(groups?.[2]?.sections);
    }),
  };

  return {
    consultationCount,
    repairedJsonRate,
    riskFlagRate,
    avgDurationSeconds,
    prescriptionTypeDist: typeDist,
    sectionCoverage,
  };
}

/**
 * Per-doctor usage stats — defaults to last 30 days.
 */
export async function computeUsageStats(
  client: SupabaseClient,
  doctorId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<UsageStats> {
  const rows = await fetchConsultations(client, windowStart, windowEnd, doctorId);

  const consultationCount = rows.length;

  if (consultationCount === 0) {
    return {
      consultationCount: 0,
      activeDays: 0,
      avgPerActiveDay: 0,
      prescriptionTypeDist: {},
      topDiagnoses: [],
      topComplaints: [],
    };
  }

  // activeDays: distinct calendar days with at least one consultation
  const daySet = new Set(
    rows
      .map((r) => r.analyzed_at?.slice(0, 10))
      .filter(Boolean),
  );
  const activeDays = daySet.size;
  const avgPerActiveDay = activeDays > 0 ? Math.round((consultationCount / activeDays) * 10) / 10 : 0;

  // prescriptionTypeDist
  const typeDist: Record<string, number> = {};
  for (const row of rows) {
    for (const pt of getPrescriptionTypes(row.form_data)) {
      typeDist[pt] = (typeDist[pt] ?? 0) + 1;
    }
  }

  // topDiagnoses
  const topDiagnoses = topN(rows, (r) => r.form_data?.diagnosis as string | undefined);

  // topComplaints (first 8 chars for grouping similar complaints)
  const topComplaints = topN(
    rows,
    (r) => (r.form_data?.chiefComplaint as string | undefined)?.slice(0, 8),
  );

  return {
    consultationCount,
    activeDays,
    avgPerActiveDay,
    prescriptionTypeDist: typeDist,
    topDiagnoses,
    topComplaints,
  };
}

/**
 * Per-doctor performance stats — defaults to last 30 days.
 */
export async function computePerformanceStats(
  client: SupabaseClient,
  doctorId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<PerformanceStats> {
  const rows = await fetchConsultations(client, windowStart, windowEnd, doctorId);

  if (rows.length === 0) {
    return {
      avgLengthPerField: {},
      repairedJsonRate: 0,
      riskFlagRate: 0,
      topDiagnosisPatternPairs: [],
    };
  }

  const FIELDS = [
    "chiefComplaint",
    "currentIllness",
    "physicalExam",
    "diagnosis",
    "pattern",
    "prescription",
    "pastHistory",
  ] as const;

  const avgLengthPerField: Record<string, number> = {};
  for (const field of FIELDS) {
    avgLengthPerField[field] = avgLength(rows, field);
  }

  const repairedJsonRate = coverageRate(rows, (r) => r.model_meta?.repairedJson === true);

  const riskFlagRate = coverageRate(
    rows,
    (r) => isNonEmptyArray((r.analysis_result as Record<string, unknown> | null)?.cautions),
  );

  // topDiagnosisPatternPairs
  const pairCounts = new Map<string, { diagnosis: string; pattern: string; count: number }>();
  for (const row of rows) {
    const diagnosis = (row.form_data?.diagnosis as string | undefined) ?? "";
    const pattern = (row.form_data?.pattern as string | undefined) ?? "";
    if (!diagnosis && !pattern) continue;
    const key = `${diagnosis}|${pattern}`;
    const existing = pairCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      pairCounts.set(key, { diagnosis, pattern, count: 1 });
    }
  }
  const topDiagnosisPatternPairs = [...pairCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    avgLengthPerField,
    repairedJsonRate,
    riskFlagRate,
    topDiagnosisPatternPairs,
  };
}
