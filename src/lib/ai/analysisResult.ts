import { CaseForm } from "@/lib/caseValidation";

export type AnalysisSectionJson = {
  title?: unknown;
  items?: unknown;
};

export type AnalysisGroupJson = {
  title?: unknown;
  sections?: unknown;
};

export type AnalysisJson = {
  重点结论?: unknown;
  病案摘要?: unknown;
  资料完整性?: {
    已提供?: unknown;
    建议补充?: unknown;
  };
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

export type AnalysisResult = {
  title: string;
  keyPoints: string[];
  summary: string;
  groups: ResultGroup[];
  cautions: string[];
  evidence: string[];
};

type GroupSpec = {
  title: string;
  sections: Array<{ title: string; fallback: string }>;
};

const GROUP_SPECS: GroupSpec[] = [
  {
    title: "资料完整性",
    sections: [
      { title: "已提供", fallback: "当前未额外归纳已提供信息，可继续结合原始病案核对。" },
      { title: "建议补充", fallback: "本次未形成新的补充提示，可继续结合面诊补全。" },
    ],
  },
  {
    title: "当前思路",
    sections: [
      { title: "可取之处", fallback: "本次未额外提炼明确保留点，可继续结合面诊判断。" },
      { title: "需要复核", fallback: "当前未识别出必须立即调整的复核点，仍建议结合面诊核对。" },
    ],
  },
  {
    title: "建议优化",
    sections: [
      { title: "主要建议", fallback: "本次未形成新的优化建议，可先结合当前方案继续观察。" },
      { title: "可选思路", fallback: "本次未提出额外备选思路。" },
    ],
  },
  {
    title: "随访监测",
    sections: [{ title: "监测建议", fallback: "可按常规复诊节奏结合症状变化继续观察。" }],
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

function withFallback(items: unknown, fallback: string): string[] {
  const normalized = normalizeStringList(items);
  return normalized.length ? normalized : [fallback];
}

function createSection(title: string, items: unknown, fallback: string): ResultSection {
  return {
    title,
    items: withFallback(items, fallback),
  };
}

function normalizeGroupMap(groups: unknown): Map<string, AnalysisGroupJson> {
  const map = new Map<string, AnalysisGroupJson>();
  if (!Array.isArray(groups)) return map;

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const title = normalizeText((group as AnalysisGroupJson).title);
    if (title) {
      map.set(title, group as AnalysisGroupJson);
    }
  }

  return map;
}

function normalizeSectionMap(sections: unknown): Map<string, AnalysisSectionJson> {
  const map = new Map<string, AnalysisSectionJson>();
  if (!Array.isArray(sections)) return map;

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const title = normalizeText((section as AnalysisSectionJson).title);
    if (title) {
      map.set(title, section as AnalysisSectionJson);
    }
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
        return createSection(sectionSpec.title, section?.items, sectionSpec.fallback);
      }),
    };
  });
}

export function buildAnalysisResult(data: AnalysisJson, caseType: CaseForm["caseType"]): AnalysisResult {
  const keyPoints = normalizeStringList(data.重点结论);
  const cautions = normalizeStringList(data.风险与提醒);
  const evidence = normalizeStringList(data.证据状态);

  const groups: ResultGroup[] = [
    {
      title: "资料完整性",
      sections: [
        createSection("已提供", data.资料完整性?.已提供, "当前未额外归纳已提供信息，可继续结合原始病案核对。"),
        createSection("建议补充", data.资料完整性?.建议补充, "本次未形成新的补充提示，可继续结合面诊补全。"),
      ],
    },
    {
      title: "当前思路",
      sections: [
        createSection("可取之处", data.当前思路?.可取之处, "本次未额外提炼明确保留点，可继续结合面诊判断。"),
        createSection("需要复核", data.当前思路?.需要复核, "当前未识别出必须立即调整的复核点，仍建议结合面诊核对。"),
      ],
    },
    {
      title: "建议优化",
      sections: [
        createSection("主要建议", data.建议优化, "本次未形成新的优化建议，可先结合当前方案继续观察。"),
        createSection("可选思路", data.可选思路, "本次未提出额外备选思路。"),
      ],
    },
    {
      title: "随访监测",
      sections: [createSection("监测建议", data.随访监测, "可按常规复诊节奏结合症状变化继续观察。")],
    },
  ];

  return {
    title: `${caseType}研判`,
    keyPoints: keyPoints.length ? keyPoints : ["当前方案仍可继续结合面诊信息复核，系统未提炼出更高优先级的结论。"],
    summary: normalizeText(data.病案摘要) || "已完成病案研判，请结合门诊面诊与复诊计划继续核对。",
    groups,
    cautions: cautions.length ? cautions : ["请结合面诊与必要检查复核后执行。"],
    evidence: evidence.length ? evidence : ["基于临床经验与通用知识，尚未接入外部文献检索。"],
  };
}

export function ensureAnalysisResult(
  value: unknown,
  caseType: CaseForm["caseType"] = "方药分析",
): AnalysisResult | null {
  if (!value || typeof value !== "object") return null;

  const record = value as {
    title?: unknown;
    keyPoints?: unknown;
    summary?: unknown;
    groups?: unknown;
    cautions?: unknown;
    evidence?: unknown;
  };

  if (Array.isArray(record.groups)) {
    return {
      title: normalizeText(record.title) || `${caseType}研判`,
      keyPoints: withFallback(
        record.keyPoints,
        "当前方案仍可继续结合面诊信息复核，系统未提炼出更高优先级的结论。",
      ),
      summary: normalizeText(record.summary) || "已完成病案研判，请结合门诊面诊与复诊计划继续核对。",
      groups: normalizeStoredGroups(record.groups),
      cautions: withFallback(record.cautions, "请结合面诊与必要检查复核后执行。"),
      evidence: withFallback(record.evidence, "基于临床经验与通用知识，尚未接入外部文献检索。"),
    };
  }

  return buildAnalysisResult(value as AnalysisJson, caseType);
}
