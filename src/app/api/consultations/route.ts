import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { createConsultation, listConsultations, updateConsultation } from "@/lib/consultations";
import { getCurrentDoctorEmail } from "@/lib/currentDoctor";
import { logServerEvent } from "@/lib/logging";

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET() {
  try {
    const doctorEmail = await getCurrentDoctorEmail();
    const records = await listConsultations(doctorEmail);
    return NextResponse.json({ records });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }

    await logServerEvent({
      source: "api/consultations",
      message: "读取病案历史失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "读取病案历史失败。");
  }
}

export async function POST(request: Request) {
  try {
    const doctorEmail = await getCurrentDoctorEmail();
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
    const draft = typeof body.draft === "string" ? body.draft.trim() : "";

    if (!draft) {
      return apiError(400, "INVALID_INPUT", "请先输入病案记录。");
    }

    const record = await createConsultation({
      doctorEmail,
      consultationName: normalizeName(body.consultationName),
      draft,
    });

    if (body.analysisStatus === "ready") {
      const saved = await updateConsultation(record.id, doctorEmail, {
        organized_case: body.organizedCase ?? null,
        analysis_result: body.analysisResult ?? null,
        analysis_raw: body.analysisRaw ?? null,
        validation_result: body.validationResult ?? null,
        model_meta: body.modelMeta ?? null,
        analysis_status: "ready",
        analyzed_at: new Date().toISOString(),
      });
      return NextResponse.json({ record: saved });
    }

    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }

    await logServerEvent({
      source: "api/consultations",
      message: "建立病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "建立病案记录失败。");
  }
}
