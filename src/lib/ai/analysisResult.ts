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
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  const single = normalizeText(value);
  return single ? [single] : [];
}

function section(title: string, items: unknown) {
  const normalized = normalizeStringList(items);
  return normalized.length ? { title, items: normalized } : null;
}

export function buildAnalysisResult(data: AnalysisJson, caseType: CaseForm["caseType"]): AnalysisResult {
  const keyPoints = normalizeStringList(data.重点结论);
  const cautions = normalizeStringList(data.风险与提醒);
  const evidence = normalizeStringList(data.证据状态);
  const completenessProvided = normalizeStringList(data.资料完整性?.已提供);
  const completenessMissing = normalizeStringList(data.资料完整性?.建议补充);
  const strengths = normalizeStringList(data.当前思路?.可取之处);
  const toReview = normalizeStringList(data.当前思路?.需要复核);
  const optimize = normalizeStringList(data.建议优化);
  const alternatives = normalizeStringList(data.可选思路);
  const followUp = normalizeStringList(data.随访监测);

  const groups: ResultGroup[] = [
    {
      title: "资料完整性",
      sections: [
        section("已提供", completenessProvided),
        section("建议补充", completenessMissing),
      ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    {
      title: "当前思路",
      sections: [
        section("可取之处", strengths),
        section("需要复核", toReview),
      ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    {
      title: "建议优化",
      sections: [
        section("主要建议", optimize),
        section("可选思路", alternatives),
      ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    {
      title: "随访监测",
      sections: [section("监测建议", followUp)].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
  ].filter((group) => group.sections.length > 0);

  return {
    title: `${caseType}研判`,
    keyPoints: keyPoints.length ? keyPoints : ["当前方案存在可优化空间，建议结合复诊信息分步调整。"],
    summary: normalizeText(data.病案摘要) || "已完成病案研判，请结合门诊复核。",
    groups,
    cautions: cautions.length ? cautions : ["请结合面诊与必要检查复核后执行。"],
    evidence: evidence.length ? evidence : ["基于临床经验与通用知识，尚未接入外部文献检索。"],
  };
}
