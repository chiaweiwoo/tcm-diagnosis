import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { callDeepSeekJson, DeepSeekError, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import {
  buildTcmAnalysisUserPrompt,
  TCM_ANALYSIS_PROMPT_VERSION,
  TCM_ANALYSIS_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { caseSchema, CaseForm, validateCaseForm } from "@/lib/caseValidation";
import { logApiCall, logServerEvent } from "@/lib/logging";

type AnalysisJson = {
  病例摘要?: string;
  病案类型?: string;
  中医辨证假设?: string[];
  当前方案评估?: string[];
  修改建议?: string[];
  备选思路?: string[];
  安全风险?: string[];
  检查与监测建议?: string[];
  证据缺口?: string[];
  需要复核的地方?: string[];
};

function section(title: string, items?: string[]) {
  return {
    title,
    items: items?.filter(Boolean) ?? [],
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as { form?: CaseForm };
    const parsed = caseSchema.safeParse(body.form);

    if (!parsed.success) {
      return NextResponse.json({ error: "病案资料未通过校验，请先复核必填字段。" }, { status: 400 });
    }

    const validation = validateCaseForm(parsed.data);

    const result = await callDeepSeekJson<AnalysisJson>({
      messages: [
        { role: "system", content: TCM_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: buildTcmAnalysisUserPrompt(parsed.data) },
      ],
      maxTokens: 1800,
      model: getDeepSeekFastModel(),
      timeoutMs: 45_000,
      repairJson: true,
    });

    after(() => logApiCall({
      route: "api/analyze",
      success: true,
      model: result.model,
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
      costUsd: result.costUsd,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      metadata: { caseType: parsed.data.caseType, repairedJson: result.repairedJson ?? false },
    }));

    const data = result.data;
    const resultType = data.病案类型 ?? parsed.data.caseType;
    const output = {
      title: `${resultType}研判`,
      summary: data.病例摘要 ?? "DeepSeek已生成分析结果。",
      sections: [
        section("辨证假设", data.中医辨证假设),
        section("当前方案评估", data.当前方案评估),
        section("修改建议", data.修改建议),
        section("备选思路", data.备选思路),
        section("检查与监测", data.检查与监测建议),
        section("证据缺口", data.证据缺口),
        section("需要复核", data.需要复核的地方),
      ].filter((item) => item.items.length > 0),
      cautions: data.安全风险?.length ? data.安全风险 : ["请结合面诊、检查与医生判断复核。"],
    };

    return NextResponse.json({
      result: output,
      raw: data,
      usage: result.usage,
      costUsd: result.costUsd,
      model: result.model,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      validation,
    });
  } catch (error) {
    if (error instanceof DeepSeekError) {
      after(() => logApiCall({
        route: "api/analyze",
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: error.message,
        promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      }));
      after(() => logServerEvent({
        source: "api/analyze",
        message: error.message,
        details: { status: error.status },
      }));
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    after(() => logApiCall({
      route: "api/analyze",
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
    }));
    after(() => logServerEvent({
      source: "api/analyze",
      message: "生成分析失败，请稍后重试。",
      details: { error: error instanceof Error ? error.message : String(error) },
    }));
    return NextResponse.json({ error: "生成分析失败，请稍后重试。" }, { status: 500 });
  }
}
