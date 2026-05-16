import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { callDeepSeekJson, DeepSeekError, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { apiError } from "@/lib/apiResponses";
import { buildTcmAnalysisUserPrompt, TCM_ANALYSIS_PROMPT_VERSION, TCM_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { structuredCaseSchema } from "@/lib/forms/caseSchema";
import { logApiCall, logServerEvent } from "@/lib/logging";
import { logActivity } from "@/lib/activityLog";
import { AnalysisJson, buildAnalysisResult } from "@/lib/ai/analysisResult";
import { requireApiAuth } from "@/lib/apiAuth";

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request);
  if (!auth.ok) return auth.response;
  const { doctorEmail, isCli } = auth;

  const startedAt = Date.now();

  try {
    const body = (await request.json()) as { form?: unknown };
    const parsed = structuredCaseSchema.safeParse(body.form);

    if (!parsed.success) {
      return apiError(400, "INVALID_INPUT", "病案资料未通过校验，请先复核必填字段。", {
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const form = parsed.data;

    const result = await callDeepSeekJson<AnalysisJson>({
      messages: [
        { role: "system", content: TCM_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: buildTcmAnalysisUserPrompt(form) },
      ],
      maxTokens: 1200,
      model: getDeepSeekFastModel(),
      timeoutMs: 45_000,
      repairJson: true,
    });

    const output = buildAnalysisResult(result.data, form.prescriptionType);
    const latencyMs = Date.now() - startedAt;

    after(() => {
      void logApiCall({
        route: "api/analyze",
        callName: "analyze",
        success: true,
        model: result.model,
        latencyMs,
        usage: result.usage,
        costUsd: result.costUsd,
        ratesSnapshot: result.costDetail.rates,
        promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
        metadata: {
          prescriptionType: form.prescriptionType,
          repairedJson: result.repairedJson ?? false,
        },
      });
      if (doctorEmail && !isCli) {
        void logActivity({
          doctorEmail,
          eventType: "analyze",
          metadata: { prescriptionType: form.prescriptionType },
        });
      }
    });

    return NextResponse.json({
      result: output,
      raw: result.data,
      usage: result.usage,
      costUsd: result.costUsd,
      model: result.model,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
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
          metadata: { stage: "failed", reason: "deepseek_call", ...(error.details ?? {}) },
        }),
      );
      after(() =>
        logServerEvent({
          source: "api/analyze",
          message: error.message,
          details: { status: error.status, stage: "deepseek_call", ...(error.details ?? {}) },
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
    return apiError(500, "INTERNAL_ERROR", "生成分析失败，请稍后重试。");
  }
}
