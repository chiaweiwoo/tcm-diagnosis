import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { deleteConsultation, getConsultation, updateConsultation } from "@/lib/consultations";
import { getCurrentDoctorEmail } from "@/lib/currentDoctor";
import { logServerEvent } from "@/lib/logging";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUnauthorized(error: unknown) {
  return error instanceof Error && error.message === "Unauthorized";
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const doctorEmail = await getCurrentDoctorEmail();
    const { id } = await context.params;
    const record = await getConsultation(id, doctorEmail);

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
    const doctorEmail = await getCurrentDoctorEmail();
    const { id } = await context.params;
    const existing = await getConsultation(id, doctorEmail);

    if (!existing) {
      return apiError(404, "NOT_FOUND", "找不到病案记录。");
    }

    const body = (await request.json()) as {
      consultationName?: unknown;
      formData?: unknown;
      analysisResult?: unknown;
      analysisRaw?: unknown;
      modelMeta?: unknown;
      analysisStatus?: unknown;
    };

    // Detect whether form data changed to reset analysis state
    const newFormData = Object.hasOwn(body, "formData") ? (body.formData ?? null) : undefined;
    const formDataChanged =
      newFormData !== undefined &&
      JSON.stringify(newFormData) !== JSON.stringify(existing.form_data);

    const record = await updateConsultation(id, doctorEmail, {
      consultation_name: Object.hasOwn(body, "consultationName")
        ? normalizeName(body.consultationName)
        : existing.consultation_name,
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
    });

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
    const doctorEmail = await getCurrentDoctorEmail();
    const { id } = await context.params;
    await deleteConsultation(id, doctorEmail);
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
