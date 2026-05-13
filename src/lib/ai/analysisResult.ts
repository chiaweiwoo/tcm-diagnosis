import { CaseForm } from "@/lib/caseValidation";

export type AnalysisJson = {
  重点结论?: string[];
  病案摘要?: string;
  资料完整性?: {
    已提供?: string[];
    建议补充?: string[];
  };
  当前思路?: {
    可取之处?: string[];
    需要复核?: string[];
  };
  建议优化?: string[];
  可选思路?: string[];
  风险与提醒?: string[];
  随访监测?: string[];
  证据状态?: string[];
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

export function cleanItems(items?: string[]) {
  return (items ?? []).map((item) => item.trim()).filter(Boolean);
}

function section(title: string, items?: string[]) {
  const normalized = cleanItems(items);
  return normalized.length ? { title, items: normalized } : null;
}

export function buildAnalysisResult(data: AnalysisJson, caseType: CaseForm["caseType"]): AnalysisResult {
  const keyPoints = cleanItems(data.重点结论);
  const cautions = cleanItems(data.风险与提醒);
  const evidence = cleanItems(data.证据状态);
  const completenessProvided = cleanItems(data.资料完整性?.已提供);
  const completenessMissing = cleanItems(data.资料完整性?.建议补充);
  const strengths = cleanItems(data.当前思路?.可取之处);
  const toReview = cleanItems(data.当前思路?.需要复核);
  const optimize = cleanItems(data.建议优化);
  const alternatives = cleanItems(data.可选思路);
  const followUp = cleanItems(data.随访监测);

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
    summary: data.病案摘要?.trim() || "已完成病案研判，请结合门诊复核。",
    groups,
    cautions: cautions.length ? cautions : ["请结合面诊与必要检查复核后执行。"],
    evidence: evidence.length ? evidence : ["基于临床经验与通用知识，尚未接入外部文献检索。"],
  };
}
