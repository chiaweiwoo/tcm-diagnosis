import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { deleteConsultation, getConsultation, updateConsultation } from "@/lib/consultations";
import { getCurrentDoctor } from "@/lib/currentDoctor";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { logServerEvent } from "@/lib/logging";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCaseId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    const wantsLockedFieldChange =
      Object.hasOwn(body, "consultationName") ||
      Object.hasOwn(body, "formData") ||
      Object.hasOwn(body, "analysisResult") ||
      Object.hasOwn(body, "analysisRaw") ||
      Object.hasOwn(body, "modelMeta") ||
      Object.hasOwn(body, "analysisStatus");

    if (existing.analysis_status === "analyzed" && wantsLockedFieldChange) {
      return apiError(409, "READ_ONLY_RECORD", "已分析病案不可修改原始内容，仅可更新病案编号、关联病案编号与给AI回馈。");
    }

    // Detect whether form data changed to reset analysis state
    const newFormData = Object.hasOwn(body, "formData") ? (body.formData ?? null) : undefined;
    const formDataChanged =
      newFormData !== undefined &&
      JSON.stringify(newFormData) !== JSON.stringify(existing.form_data);

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
              form_data: newFormData,
              analysis_status: formDataChanged ? "draft" : existing.analysis_status,
              ...(formDataChanged
                ? {
                    analysis_result: null,
                    analysis_raw: null,
                    model_meta: null,
                    analyzed_at: null,
                  }
                : {}),
            }
          : {}),
        ...(Object.hasOwn(body, "analysisResult") ? { analysis_result: body.analysisResult ?? null } : {}),
        ...(Object.hasOwn(body, "analysisRaw") ? { analysis_raw: body.analysisRaw ?? null } : {}),
        ...(Object.hasOwn(body, "modelMeta") ? { model_meta: body.modelMeta ?? null } : {}),
        ...(body.analysisStatus === "analyzed"
          ? { analysis_status: "analyzed", analyzed_at: new Date().toISOString() }
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
