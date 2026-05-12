import { NextRequest, NextResponse } from "next/server";
import { callDeepSeekJson, DeepSeekError } from "@/lib/ai/deepseek";
import {
  buildTcmOrganizeUserPrompt,
  TCM_ORGANIZE_PROMPT_VERSION,
  TCM_ORGANIZE_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { CaseForm } from "@/lib/caseValidation";

type OrganizedCase = {
  病案类型?: string;
  年龄?: string;
  性别?: string;
  体质与生活背景?: string;
  主诉?: string;
  病程?: string;
  病史与治疗反应?: string;
  当前方案?: string;
  方药内容?: string;
  穴位与操作?: string;
  医生问题?: string;
  整理备注?: string[];
  建议补充?: string[];
};

const validCaseTypes = ["方药分析", "针灸方案", "综合调理"] as const;

function normalizeCaseType(value?: string): CaseForm["caseType"] {
  if (validCaseTypes.includes(value as CaseForm["caseType"])) {
    return value as CaseForm["caseType"];
  }

  return "综合调理";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { draft?: string };
    const draft = body.draft?.trim();

    if (!draft) {
      return NextResponse.json({ error: "请先输入医生草稿。" }, { status: 400 });
    }

    const result = await callDeepSeekJson<OrganizedCase>({
      messages: [
        { role: "system", content: TCM_ORGANIZE_SYSTEM_PROMPT },
        { role: "user", content: buildTcmOrganizeUserPrompt(draft) },
      ],
      maxTokens: 1800,
    });

    const data = result.data;
    const form: CaseForm = {
      caseType: normalizeCaseType(data.病案类型),
      age: data.年龄 ?? "",
      sex: data.性别 ?? "",
      constitution: data.体质与生活背景 ?? "",
      chiefComplaint: data.主诉 ?? "",
      duration: data.病程 ?? "",
      history: data.病史与治疗反应 ?? draft,
      currentPlan: data.当前方案 ?? "",
      herbs: data.方药内容 ?? "",
      acupoints: data.穴位与操作 ?? "",
      doctorQuestion: data.医生问题 ?? "请判断当前方案可如何改良，并指出风险与需要补充的信息。",
      modelMode: "深度模式",
    };

    return NextResponse.json({
      form,
      notes: data.整理备注 ?? [],
      suggestions: data.建议补充 ?? [],
      usage: result.usage,
      costUsd: result.costUsd,
      model: result.model,
      promptVersion: TCM_ORGANIZE_PROMPT_VERSION,
    });
  } catch (error) {
    if (error instanceof DeepSeekError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "整理病案失败，请稍后重试。" }, { status: 500 });
  }
}
