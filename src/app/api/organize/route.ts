import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { callDeepSeekJson, DeepSeekError, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { apiError } from "@/lib/apiResponses";
import {
  buildTcmOrganizeUserPrompt,
  TCM_ORGANIZE_PROMPT_VERSION,
  TCM_ORGANIZE_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { logApiCall, logServerEvent } from "@/lib/logging";
import { mapOrganizedCaseToForm, OrganizedCaseRaw } from "@/lib/ai/organizeCase";
import { MAX_ORGANIZE_DRAFT_CHARS, validateDraftLength } from "@/lib/inputLimits";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as { draft?: string };
    const draft = body.draft?.trim();

    if (!draft) {
      return apiError(400, "INVALID_INPUT", "请先输入医生草稿。");
    }

    const draftLength = validateDraftLength(draft);
    if (draftLength.tooLong) {
      return apiError(
        400,
        "DRAFT_TOO_LONG",
        `草稿内容过长，请精简后重新提交（上限${MAX_ORGANIZE_DRAFT_CHARS}字符）。`,
        { maxChars: MAX_ORGANIZE_DRAFT_CHARS, actualChars: draftLength.length },
      );
    }

    const result = await callDeepSeekJson<OrganizedCaseRaw>({
      messages: [
        { role: "system", content: TCM_ORGANIZE_SYSTEM_PROMPT },
        { role: "user", content: buildTcmOrganizeUserPrompt(draft) },
      ],
      maxTokens: 1800,
      model: getDeepSeekFastModel(),
      timeoutMs: 30_000,
      repairJson: true,
    });

    const mapped = mapOrganizedCaseToForm(result.data, draft);
    const latencyMs = Date.now() - startedAt;

    after(() =>
      logApiCall({
        route: "api/organize",
        callName: "organize",
        success: true,
        model: result.model,
        latencyMs,
        usage: result.usage,
        costUsd: result.costUsd,
        inputRatePer1m: result.costDetail.rates.inputCacheMissPer1M,
        outputRatePer1m: result.costDetail.rates.outputPer1M,
        cacheHitRatePer1m: result.costDetail.rates.inputCacheHitPer1M,
        promptVersion: TCM_ORGANIZE_PROMPT_VERSION,
        metadata: {
          draftLength: draft.length,
          repairedJson: result.repairedJson ?? false,
        },
      }),
    );

      return NextResponse.json({
        form: mapped.form,
        notes: mapped.notes,
        suggestions: mapped.suggestions,
      usage: result.usage,
      costUsd: result.costUsd,
      model: result.model,
      promptVersion: TCM_ORGANIZE_PROMPT_VERSION,
    });
  } catch (error) {
    if (error instanceof DeepSeekError) {
      after(() => logApiCall({
        route: "api/organize",
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: error.message,
        promptVersion: TCM_ORGANIZE_PROMPT_VERSION,
        metadata: { stage: "failed", reason: "deepseek_call" },
      }));
      after(() => logServerEvent({
        source: "api/organize",
        message: error.message,
        details: { status: error.status, stage: "deepseek_call" },
      }));
      return apiError(error.status, "AI_REQUEST_FAILED", error.message, error.details);
    }

    after(() => logApiCall({
      route: "api/organize",
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      promptVersion: TCM_ORGANIZE_PROMPT_VERSION,
      metadata: { stage: "failed", reason: "normalize_or_map" },
    }));
    after(() => logServerEvent({
      source: "api/organize",
      message: "整理病案失败，请稍后重试。",
      details: { error: error instanceof Error ? error.message : String(error), stage: "normalize_or_map" },
    }));
    return apiError(500, "INTERNAL_ERROR", "整理病案失败，请稍后重试。");
  }
}
