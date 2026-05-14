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

function normalizeDraft(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
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
      draft?: unknown;
      organizedCase?: unknown;
      analysisResult?: unknown;
      analysisRaw?: unknown;
      validationResult?: unknown;
      modelMeta?: unknown;
      analysisStatus?: unknown;
    };
    const draft = normalizeDraft(body.draft);
    const draftChanged = draft !== undefined && draft !== existing.draft.trim();

    const record = await updateConsultation(id, doctorEmail, {
      consultation_name: Object.hasOwn(body, "consultationName")
        ? normalizeName(body.consultationName)
        : existing.consultation_name,
      ...(draft !== undefined
        ? {
            draft,
            analysis_status: draftChanged ? "stale" : existing.analysis_status,
            ...(draftChanged
              ? {
                  organized_case: null,
                  analysis_result: null,
                  analysis_raw: null,
                  validation_result: null,
                  model_meta: null,
                  analyzed_at: null,
                }
              : {}),
          }
        : {}),
      ...(Object.hasOwn(body, "organizedCase") ? { organized_case: body.organizedCase ?? null } : {}),
      ...(Object.hasOwn(body, "analysisResult") ? { analysis_result: body.analysisResult ?? null } : {}),
      ...(Object.hasOwn(body, "analysisRaw") ? { analysis_raw: body.analysisRaw ?? null } : {}),
      ...(Object.hasOwn(body, "validationResult") ? { validation_result: body.validationResult ?? null } : {}),
      ...(Object.hasOwn(body, "modelMeta") ? { model_meta: body.modelMeta ?? null } : {}),
      ...(body.analysisStatus === "ready"
        ? { analysis_status: "ready", analyzed_at: new Date().toISOString() }
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
