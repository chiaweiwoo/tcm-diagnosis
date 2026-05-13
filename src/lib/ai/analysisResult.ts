import { CaseForm } from "@/lib/caseValidation";

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

export type ResultGroup = {
  title: string;
  sections: Array<{ title: string; items: string[] }>;
};

export type AnalysisResult = {
  title: string;
  keyPoints: string[];
  summary: string;
  groups: ResultGroup[];
  cautions: string[];
  evidence: string[];
};

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

function stableSection(title: string, items: unknown, fallback: string) {
  const normalized = normalizeStringList(items);
  return {
    title,
    items: normalized.length ? normalized : [fallback],
  };
}

export function buildAnalysisResult(data: AnalysisJson, caseType: CaseForm["caseType"]): AnalysisResult {
  const keyPoints = normalizeStringList(data.重点结论);
  const cautions = normalizeStringList(data.风险与提醒);
  const evidence = normalizeStringList(data.证据状态);

  const groups: ResultGroup[] = [
    {
      title: "资料完整性",
      sections: [
        stableSection("已提供", data.资料完整性?.已提供, "当前未额外归纳已提供信息，可继续结合原始病案核对。"),
        stableSection("建议补充", data.资料完整性?.建议补充, "本次未形成新的补充提示，可继续结合面诊补全。"),
      ],
    },
    {
      title: "当前思路",
      sections: [
        stableSection("可取之处", data.当前思路?.可取之处, "本次未额外提炼明确保留点，可继续结合面诊判断。"),
        stableSection("需要复核", data.当前思路?.需要复核, "当前未识别出必须立即调整的复核点，仍建议结合面诊核对。"),
      ],
    },
    {
      title: "建议优化",
      sections: [
        stableSection("主要建议", data.建议优化, "本次未形成新的优化建议，可先结合当前方案继续观察。"),
        stableSection("可选思路", data.可选思路, "本次未提出额外备选思路。"),
      ],
    },
    {
      title: "随访监测",
      sections: [stableSection("监测建议", data.随访监测, "可按常规复诊节奏结合症状变化继续观察。")],
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
