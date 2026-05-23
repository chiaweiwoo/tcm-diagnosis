import { PrescriptionType } from "@/lib/forms/caseSchema";

/** Normalise prescriptionType from DB — old rows may store an array, new rows store a string. */
export function normalizePrescriptionType(value: unknown): PrescriptionType {
  if (typeof value === "string" && value) return value as PrescriptionType;
  if (Array.isArray(value) && value.length > 0) return value[0] as PrescriptionType;
  return "方药";
}

export type CriticalRisk = {
  summary: string;
  highlights: string[];
};

export type AnalysisJson = {
  criticalRisk?: { summary?: unknown; highlights?: unknown } | null;
  重点结论?: unknown;
  当前思路?: {
    可取之处?: unknown;
    需要复核?: unknown;
  };
  建议优化?: unknown;
  可选思路?: unknown;
  风险与提醒?: unknown;
  随访监测?: unknown;
  证据状态?: unknown;
};

export type ResultSection = {
  title: string;
  items: string[];
};

export type ResultGroup = {
  title: string;
  sections: ResultSection[];
};

/**
 * Normalised analysis result.
 * groups maps to 3 UI columns: 判断 / 方案 / 随访安全
 */
export type AnalysisResult = {
  title: string;
  keyPoints: string[];  // 重点结论
  criticalRisk: CriticalRisk | null;  // 辨证警示 — null when no alert
  groups: ResultGroup[];
  cautions: string[];   // 风险与提醒
  evidence: string[];   // 证据状态
};

type GroupSpec = {
  title: string;
  sections: Array<{ title: string }>;
};

const GROUP_SPECS: GroupSpec[] = [
  {
    title: "判断",
    sections: [{ title: "可取之处" }, { title: "需要复核" }],
  },
  {
    title: "方案",
    sections: [{ title: "建议优化" }, { title: "可选思路" }],
  },
  {
    title: "随访监测",
    sections: [{ title: "随访监测" }],
  },
];

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

export function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  const single = normalizeText(value);
  return single ? [single] : [];
}

function normalizeCriticalRisk(value: unknown): CriticalRisk | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as { summary?: unknown; highlights?: unknown };
  const summary = normalizeText(obj.summary);
  if (!summary) return null;
  const highlights = normalizeStringList(obj.highlights);
  if (highlights.length === 0) return null;
  return { summary, highlights };
}

function withFallback(items: unknown, fallback: string): string[] {
  const normalized = normalizeStringList(items);
  return normalized.length ? normalized : [fallback];
}

function createSection(title: string, items: unknown): ResultSection {
  return { title, items: normalizeStringList(items) };
}

// ---------------------------------------------------------------------------
// Normalise groups coming from stored JSON (legacy compat)
// ---------------------------------------------------------------------------

type AnyGroupRecord = { title?: unknown; sections?: unknown };
type AnySectionRecord = { title?: unknown; items?: unknown };

function normalizeGroupMap(groups: unknown): Map<string, AnyGroupRecord> {
  const map = new Map<string, AnyGroupRecord>();
  if (!Array.isArray(groups)) return map;
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const title = normalizeText((group as AnyGroupRecord).title);
    if (title) map.set(title, group as AnyGroupRecord);
  }
  return map;
}

function normalizeSectionMap(sections: unknown): Map<string, AnySectionRecord> {
  const map = new Map<string, AnySectionRecord>();
  if (!Array.isArray(sections)) return map;
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const title = normalizeText((section as AnySectionRecord).title);
    if (title) map.set(title, section as AnySectionRecord);
  }
  return map;
}

function normalizeStoredGroups(groups: unknown): ResultGroup[] {
  const groupMap = normalizeGroupMap(groups);
  return GROUP_SPECS.map((spec) => {
    const sectionMap = normalizeSectionMap(groupMap.get(spec.title)?.sections);
    return {
      title: spec.title,
      sections: spec.sections.map((sectionSpec) => {
        const section = sectionMap.get(sectionSpec.title);
        return createSection(sectionSpec.title, section?.items);
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Build from fresh AI response
// ---------------------------------------------------------------------------

export function buildAnalysisResult(data: AnalysisJson, prescriptionType: PrescriptionType): AnalysisResult {
  return {
    title: `${prescriptionType}研判`,
    criticalRisk: normalizeCriticalRisk(data.criticalRisk),
    keyPoints: withFallback(
      data.重点结论,
      "当前方案仍可继续结合面诊信息复核，系统未提炼出更高优先级的结论。",
    ),
    groups: [
      {
        title: "判断",
        sections: [
          createSection("可取之处", data.当前思路?.可取之处),
          createSection("需要复核", data.当前思路?.需要复核),
        ],
      },
      {
        title: "方案",
        sections: [
          createSection("建议优化", data.建议优化),
          createSection("可选思路", data.可选思路),
        ],
      },
      {
        title: "随访监测",
        sections: [createSection("随访监测", data.随访监测)],
      },
    ],
    cautions: withFallback(data.风险与提醒, "请结合面诊与必要检查复核后执行。"),
    evidence: withFallback(data.证据状态, "基于临床经验与通用知识，尚未接入外部文献检索。"),
  };
}

// ---------------------------------------------------------------------------
// Normalise a stored result (may be legacy format or already normalised)
// ---------------------------------------------------------------------------

export function ensureAnalysisResult(
  value: unknown,
  prescriptionType: PrescriptionType = "方药",
): AnalysisResult | null {
  if (!value || typeof value !== "object") return null;

  const record = value as {
    title?: unknown;
    keyPoints?: unknown;
    criticalRisk?: unknown;
    groups?: unknown;
    cautions?: unknown;
    evidence?: unknown;
  };

  if (Array.isArray(record.groups)) {
    return {
      title: normalizeText(record.title) || `${prescriptionType}研判`,
      criticalRisk: normalizeCriticalRisk(record.criticalRisk),
      keyPoints: withFallback(
        record.keyPoints,
        "当前方案仍可继续结合面诊信息复核，系统未提炼出更高优先级的结论。",
      ),
      groups: normalizeStoredGroups(record.groups),
      cautions: withFallback(record.cautions, "请结合面诊与必要检查复核后执行。"),
      evidence: withFallback(record.evidence, "基于临床经验与通用知识，尚未接入外部文献检索。"),
    };
  }

  return buildAnalysisResult(value as AnalysisJson, prescriptionType);
}
