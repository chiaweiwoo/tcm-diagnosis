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
      formData?: unknown;
      analysisResult?: unknown;
      analysisRaw?: unknown;
      modelMeta?: unknown;
      analysisStatus?: unknown;
    };

    const record = await createConsultation({
      doctorEmail,
      consultationName: normalizeName(body.consultationName),
      formData: body.formData ?? null,
    });

    if (body.analysisStatus === "analyzed") {
      const saved = await updateConsultation(record.id, doctorEmail, {
        analysis_result: body.analysisResult ?? null,
        analysis_raw: body.analysisRaw ?? null,
        model_meta: body.modelMeta ?? null,
        analysis_status: "analyzed",
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
