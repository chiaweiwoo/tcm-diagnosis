import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { callDeepSeekJson, DeepSeekError, getDeepSeekAnalyzeModel, getDeepSeekSmartModel } from "@/lib/ai/deepseek";
import { apiError } from "@/lib/apiResponses";
import {
  buildTcmAnalysisUserPrompt,
  TCM_ANALYSIS_PROMPT_VERSION,
  TCM_ANALYSIS_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { caseSchema, CaseForm, validateCaseForm } from "@/lib/caseValidation";
import { logApiCall, logServerEvent } from "@/lib/logging";
import { AnalysisJson, buildAnalysisResult } from "@/lib/ai/analysisResult";
import { requireApiAuth } from "@/lib/apiAuth";

export async function POST(request: NextRequest) {
  const denied = await requireApiAuth(request);
  if (denied) return denied;

  const startedAt = Date.now();
  let reviewMode: "smart" | "normal" = "smart";

  try {
    const body = (await request.json()) as { form?: CaseForm; mode?: "smart" | "normal" };
    const parsed = caseSchema.safeParse(body.form);

    if (!parsed.success) {
      return apiError(400, "INVALID_INPUT", "病案资料未通过校验，请先复核必填字段。");
    }

    reviewMode = body.mode === "normal" ? "normal" : "smart";

    const validation = validateCaseForm(parsed.data);
    if (!validation.canProceed) {
      return apiError(400, "VALIDATION_BLOCKED", "病案资料未通过校验，请先根据资料整理提示补充后再复核。", {
        stageOneHints: validation.stageOneHints,
        blockedReasons: validation.blockedReasons,
      });
    }

    const result = await callDeepSeekJson<AnalysisJson>({
      messages: [
        { role: "system", content: TCM_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: buildTcmAnalysisUserPrompt(parsed.data) },
      ],
      maxTokens: reviewMode === "smart" ? 1100 : 1400,
      model: reviewMode === "smart" ? getDeepSeekSmartModel() : getDeepSeekAnalyzeModel(),
      timeoutMs: 45_000,
      repairJson: true,
    });

    const data = result.data;
    const output = buildAnalysisResult(data, parsed.data.caseType);
    const latencyMs = Date.now() - startedAt;

    after(() =>
      logApiCall({
        route: "api/analyze",
        callName: reviewMode === "normal" ? "analyze-normal" : "analyze-smart",
        success: true,
        model: result.model,
        latencyMs,
        usage: result.usage,
        costUsd: result.costUsd,
        ratesSnapshot: result.costDetail.rates,
        promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
        metadata: {
          caseType: parsed.data.caseType,
          repairedJson: result.repairedJson ?? false,
          reviewMode,
        },
      }),
    );

    return NextResponse.json({
      result: output,
      raw: data,
      usage: result.usage,
      costUsd: result.costUsd,
      model: result.model,
      reviewMode,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      validation,
      repairedJson: result.repairedJson ?? false,
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
          metadata: { stage: "failed", reason: "deepseek_call", reviewMode, ...(error.details ?? {}) },
        }),
      );
      after(() =>
        logServerEvent({
          source: "api/analyze",
          message: error.message,
          details: { status: error.status, stage: "deepseek_call", reviewMode, ...(error.details ?? {}) },
        }),
      );
      return apiError(error.status, "AI_REQUEST_FAILED", error.message, error.details);
    }

    after(() =>
      logApiCall({
        route: "api/analyze",
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
        promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
        metadata: { stage: "failed", reason: "normalize_or_map", reviewMode },
      }),
    );
    after(() =>
      logServerEvent({
        source: "api/analyze",
        message: "生成分析失败，请稍后重试。",
        details: { error: error instanceof Error ? error.message : String(error), stage: "normalize_or_map" },
      }),
    );
    return apiError(500, "INTERNAL_ERROR", "生成分析失败，请稍后重试。");
  }
}
