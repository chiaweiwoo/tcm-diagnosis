import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { callDeepSeekJson, DeepSeekError, getDeepSeekModel } from "@/lib/ai/deepseek";
import {
  buildTcmAnalysisUserPrompt,
  TCM_ANALYSIS_PROMPT_VERSION,
  TCM_ANALYSIS_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { caseSchema, CaseForm, validateCaseForm } from "@/lib/caseValidation";
import { logApiCall, logServerEvent } from "@/lib/logging";
import { AnalysisJson, buildAnalysisResult } from "@/lib/ai/analysisResult";

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
      model: getDeepSeekModel(),
      timeoutMs: 45_000,
      repairJson: true,
    });

    const data = result.data;
    const output = buildAnalysisResult(data, parsed.data.caseType);
    const latencyMs = Date.now() - startedAt;

    after(() =>
      logApiCall({
        route: "api/analyze",
        success: true,
        model: result.model,
        latencyMs,
        usage: result.usage,
        costUsd: result.costUsd,
        promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
        metadata: {
          stage: "completed",
          caseType: parsed.data.caseType,
          repairedJson: result.repairedJson ?? false,
        },
      }),
    );

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
      after(() =>
        logApiCall({
          route: "api/analyze",
          success: false,
          latencyMs: Date.now() - startedAt,
          errorMessage: error.message,
          promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
          metadata: { stage: "failed", reason: "deepseek_call" },
        }),
      );
      after(() =>
        logServerEvent({
          source: "api/analyze",
          message: error.message,
          details: { status: error.status, stage: "deepseek_call" },
        }),
      );
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    after(() =>
      logApiCall({
        route: "api/analyze",
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
        promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
        metadata: { stage: "failed", reason: "normalize_or_map" },
      }),
    );
    after(() =>
      logServerEvent({
        source: "api/analyze",
        message: "生成分析失败，请稍后重试。",
        details: { error: error instanceof Error ? error.message : String(error), stage: "normalize_or_map" },
      }),
    );
    return NextResponse.json({ error: "生成分析失败，请稍后重试。" }, { status: 500 });
  }
}
