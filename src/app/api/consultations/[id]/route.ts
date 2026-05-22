import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { deleteConsultation, getConsultation, updateConsultation } from "@/lib/consultations";
import { structuredCaseSchema } from "@/lib/forms/caseSchema";
import { getCurrentDoctor } from "@/lib/currentDoctor";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { logServerEvent } from "@/lib/logging";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const CASE_ID_MAX_LENGTH = 64;

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCaseId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CASE_ID_MAX_LENGTH) {
    throw new Error("CASE_ID_TOO_LONG");
  }
  return trimmed;
}

function isUnauthorized(error: unknown) {
  return error instanceof Error && error.message === "Unauthorized";
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const doctor = await getCurrentDoctor();
    const supabase = doctor.isDevBypass ? getServiceRoleClient() : await createServerSupabaseClient();
    const dbOpts = doctor.isDevBypass ? { doctorEmail: doctor.email } : {};
    const { id } = await context.params;
    const record = await getConsultation(supabase, id, dbOpts);

    if (!record) {
      return apiError(404, "NOT_FOUND", "找不到病案记录。");
    }

    return NextResponse.json({ record });
  } catch (error) {
    if (isUnauthorized(error)) {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }

    if (error instanceof Error && error.message === "CASE_ID_TOO_LONG") {
      return apiError(400, "CASE_ID_TOO_LONG", "病案编号与随访病案编号不能超过64个字符。");
    }
    await logServerEvent({
      source: "api/consultations/[id]",
      message: "读取病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "读取病案记录失败。");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const doctor = await getCurrentDoctor();
    const supabase = doctor.isDevBypass ? getServiceRoleClient() : await createServerSupabaseClient();
    const dbOpts = doctor.isDevBypass ? { doctorEmail: doctor.email } : {};
    const { id } = await context.params;
    const existing = await getConsultation(supabase, id, dbOpts);

    if (!existing) {
      return apiError(404, "NOT_FOUND", "找不到病案记录。");
    }

    const body = (await request.json()) as {
      consultationName?: unknown;
      caseId?: unknown;
      relatedCaseId?: unknown;
      aiFeedback?: unknown;
      formData?: unknown;
      analysisResult?: unknown;
      analysisRaw?: unknown;
      modelMeta?: unknown;
      analysisStatus?: unknown;
    };

    const caseIdValue = Object.hasOwn(body, "caseId")
      ? normalizeCaseId(body.caseId)
      : undefined;
    const relatedCaseIdValue = Object.hasOwn(body, "relatedCaseId")
      ? normalizeCaseId(body.relatedCaseId)
      : undefined;
    const feedbackValue = Object.hasOwn(body, "aiFeedback")
      ? (typeof body.aiFeedback === "string" ? body.aiFeedback.trim() : "")
      : undefined;
    const newFormData = Object.hasOwn(body, "formData")
      ? structuredCaseSchema.safeParse(body.formData)
      : undefined;
    const hasAnalysisPayload =
      Object.hasOwn(body, "analysisResult") ||
      Object.hasOwn(body, "analysisRaw") ||
      Object.hasOwn(body, "modelMeta") ||
      Object.hasOwn(body, "analysisStatus");
    const hasCompleteAnalysisPayload =
      hasAnalysisPayload &&
      newFormData !== undefined &&
      newFormData.success &&
      Object.hasOwn(body, "analysisResult") &&
      Object.hasOwn(body, "analysisRaw") &&
      Object.hasOwn(body, "modelMeta") &&
      body.analysisStatus === "analyzed";

    if (newFormData && !newFormData.success) {
      const message = newFormData.error.issues[0]?.message ?? "病案字段不符合要求。";
      return apiError(400, "INVALID_INPUT", message);
    }

    if (hasAnalysisPayload && !hasCompleteAnalysisPayload) {
      return apiError(400, "INVALID_INPUT", "分析结果更新必须与完整病案表单一起保存。");
    }

    const record = await updateConsultation(
      supabase,
      id,
      {
        consultation_name: Object.hasOwn(body, "consultationName")
          ? normalizeName(body.consultationName)
          : existing.consultation_name,
        ...(caseIdValue !== undefined
          ? {
              case_id: caseIdValue,
              case_id_updated_at: new Date().toISOString(),
            }
          : {}),
        ...(relatedCaseIdValue !== undefined
          ? {
              related_case_id: relatedCaseIdValue,
              related_case_id_updated_at: new Date().toISOString(),
            }
          : {}),
        ...(feedbackValue !== undefined
          ? {
              ai_feedback: feedbackValue || null,
              ai_feedback_updated_at: new Date().toISOString(),
            }
          : {}),
        ...(newFormData !== undefined
          ? {
              form_data: newFormData.data,
            }
          : {}),
        // Mark analysis as stale when form_data is edited without a paired re-analysis.
        // Cleared when a full analysis payload is saved. This persists across page reloads.
        ...(newFormData !== undefined && !hasCompleteAnalysisPayload && existing.analysis_status === "analyzed"
          ? { analysis_stale: true }
          : {}),
        ...(hasCompleteAnalysisPayload ? { analysis_result: body.analysisResult ?? null } : {}),
        ...(hasCompleteAnalysisPayload ? { analysis_raw: body.analysisRaw ?? null } : {}),
        ...(hasCompleteAnalysisPayload ? { model_meta: body.modelMeta ?? null } : {}),
        ...(hasCompleteAnalysisPayload
          ? { analysis_status: "analyzed", analyzed_at: new Date().toISOString(), analysis_stale: false }
          : {}),
      },
      dbOpts,
    );

    return NextResponse.json({ record });
  } catch (error) {
    if (isUnauthorized(error)) {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }

    await logServerEvent({
      source: "api/consultations/[id]",
      message: "更新病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "更新病案记录失败。");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const doctor = await getCurrentDoctor();
    const supabase = doctor.isDevBypass ? getServiceRoleClient() : await createServerSupabaseClient();
    const dbOpts = doctor.isDevBypass ? { doctorEmail: doctor.email } : {};
    const { id } = await context.params;
    await deleteConsultation(supabase, id, dbOpts);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorized(error)) {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }

    await logServerEvent({
      source: "api/consultations/[id]",
      message: "删除病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "删除病案记录失败。");
  }
}
