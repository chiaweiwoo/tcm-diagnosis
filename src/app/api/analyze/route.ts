import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { callDeepSeekJson, DeepSeekError, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { apiError } from "@/lib/apiResponses";
import { buildTcmAnalysisUserPrompt, TCM_ANALYSIS_PROMPT_VERSION, TCM_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { structuredCaseSchema } from "@/lib/forms/caseSchema";
import { logServerEvent } from "@/lib/logging";
import { logActivity } from "@/lib/activityLog";
import { AnalysisJson, buildAnalysisResult } from "@/lib/ai/analysisResult";
import { requireApiAuth } from "@/lib/apiAuth";
import { getLangfuse } from "@/lib/langfuse";
import { assertWritable, getRequestedViewAsDoctorId, getViewAsContext, ViewAsError } from "@/lib/viewAs";

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request);
  if (!auth.ok) return auth.response;
  const { doctorEmail, isCli } = auth;

  try {
    if (getRequestedViewAsDoctorId(request)) {
      if (isCli) {
        return apiError(403, "VIEW_AS_FORBIDDEN", "预览医生工作台仅支持管理员会话。");
      }
      const viewAs = await getViewAsContext(request);
      const blocked = assertWritable(viewAs);
      if (blocked) return blocked;
    }
  } catch (error) {
    if (error instanceof ViewAsError) {
      return apiError(error.status, error.code, error.message);
    }
    throw error;
  }

  const startedAt = Date.now();
  const langfuse = getLangfuse();
  // Trace created here so it is accessible in both success and error paths
  const trace = langfuse?.trace({
    name: "analyze",
    metadata: { isCli, promptVersion: TCM_ANALYSIS_PROMPT_VERSION },
  });

  try {
    const body = (await request.json()) as { form?: unknown };
    const parsed = structuredCaseSchema.safeParse(body.form);

    if (!parsed.success) {
      return apiError(400, "INVALID_INPUT", "病案资料未通过校验，请先复核必填字段。", {
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const form = parsed.data;

    const deepseekStartedAt = Date.now();

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

    after(async () => {
      // Langfuse: tokens + computed cost only.
      // NO clinical text — form fields and AI output stay in Supabase exclusively.
      if (langfuse && trace) {
        const u = result.usage;
        const inputTokens  = u?.prompt_tokens             ?? 0;
        const outputTokens = u?.completion_tokens         ?? 0;
        const totalTokens  = u?.total_tokens              ?? 0;
        const cacheHit     = u?.prompt_cache_hit_tokens   ?? 0;
        const cacheMiss    = u?.prompt_cache_miss_tokens  ?? 0;

        // DeepSeek Chat (V3 / Flash) pricing in USD per 1M tokens.
        // Override via env vars if the model changes.
        const HIT_PER_M  = parseFloat(process.env.DEEPSEEK_PRICE_INPUT_HIT  ?? "0.07");
        const MISS_PER_M = parseFloat(process.env.DEEPSEEK_PRICE_INPUT_MISS ?? "0.27");
        const OUT_PER_M  = parseFloat(process.env.DEEPSEEK_PRICE_OUTPUT     ?? "1.10");

        const inputCostUsd  = (cacheHit * HIT_PER_M + cacheMiss * MISS_PER_M) / 1_000_000;
        const outputCostUsd = (outputTokens * OUT_PER_M) / 1_000_000;
        const totalCostUsd  = inputCostUsd + outputCostUsd;

        trace.generation({
          name: "deepseek-analyze",
          model: result.model,
          startTime: new Date(deepseekStartedAt),
          endTime: new Date(),
          // usage — standard field Langfuse uses for model registry lookup
          usage: {
            input:  inputTokens,
            output: outputTokens,
            total:  totalTokens,
            unit:   "TOKENS",
          },
          // usageDetails — cache breakdown for visibility in the UI
          usageDetails: {
            cacheHit,
            cacheMiss,
          },
          // costDetails — explicit USD cost so Langfuse shows it even without
          // DeepSeek in its model registry
          costDetails: {
            input:  inputCostUsd,
            output: outputCostUsd,
            total:  totalCostUsd,
          },
          metadata: {
            prescriptionType: form.prescriptionType,
            repairedJson:     result.repairedJson ?? false,
            latencyMs,
            promptVersion:    TCM_ANALYSIS_PROMPT_VERSION,
          },
        });
        try { await langfuse.flushAsync(); } catch { /* non-critical */ }
      }
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
      model: result.model,
      promptVersion: TCM_ANALYSIS_PROMPT_VERSION,
      repairedJson: result.repairedJson ?? false,
    });
  } catch (error) {
    if (error instanceof DeepSeekError) {
      after(async () => {
        if (langfuse && trace) {
          trace.update({ metadata: { error: error.message, stage: "deepseek_call", success: false } });
          try { await langfuse.flushAsync(); } catch { /* non-critical */ }
        }
        void logServerEvent({
          source: "api/analyze",
          message: error.message,
          details: { status: error.status, stage: "deepseek_call", ...(error.details ?? {}) },
        });
      });
      return apiError(error.status, "AI_REQUEST_FAILED", error.message, error.details);
    }

    after(async () => {
      if (langfuse && trace) {
        trace.update({ metadata: { stage: "normalize_or_map", success: false } });
        try { await langfuse.flushAsync(); } catch { /* non-critical */ }
      }
      void logServerEvent({
        source: "api/analyze",
        message: "生成分析失败，请稍后重试。",
        details: { error: error instanceof Error ? error.message : String(error), stage: "normalize_or_map" },
      });
    });
    return apiError(500, "INTERNAL_ERROR", "生成分析失败，请稍后重试。");
  }
}
