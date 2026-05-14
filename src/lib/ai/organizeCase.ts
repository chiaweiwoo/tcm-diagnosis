import { CaseForm } from "@/lib/caseValidation";

export type OrganizedCaseRaw = {
  病案类型?: unknown;
  年龄?: unknown;
  性别?: unknown;
  体质与生活背景?: unknown;
  舌脉与四诊要点?: unknown;
  主诉?: unknown;
  病程?: unknown;
  病史与治疗反应?: unknown;
  当前方案?: unknown;
  方药内容?: unknown;
  穴位与操作?: unknown;
  医生问题?: unknown;
  整理备注?: unknown;
  建议补充?: unknown;
};

const validCaseTypes = ["方药分析", "针灸方案", "综合调理"] as const;

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  const single = normalizeText(value);
  return single ? [single] : [];
}

function normalizeCaseType(value: unknown): CaseForm["caseType"] {
  const text = normalizeText(value);
  if (validCaseTypes.includes(text as CaseForm["caseType"])) {
    return text as CaseForm["caseType"];
  }

  return "综合调理";
}

export function mapOrganizedCaseToForm(data: OrganizedCaseRaw, draft: string) {
  const form: CaseForm = {
    caseType: normalizeCaseType(data.病案类型),
    age: normalizeText(data.年龄),
    sex: normalizeText(data.性别),
    constitution: normalizeText(data.体质与生活背景),
    tonguePulse: normalizeText(data.舌脉与四诊要点),
    chiefComplaint: normalizeText(data.主诉),
    duration: normalizeText(data.病程),
    history: normalizeText(data.病史与治疗反应) || draft,
    currentPlan: normalizeText(data.当前方案),
    herbs: normalizeText(data.方药内容),
    acupoints: normalizeText(data.穴位与操作),
    doctorQuestion: normalizeText(data.医生问题),
    modelMode: "快速模式",
  };

  return {
    form,
    notes: normalizeStringList(data.整理备注),
    suggestions: normalizeStringList(data.建议补充),
  };
}
