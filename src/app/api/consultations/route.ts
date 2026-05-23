import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { createConsultation, listConsultations, updateConsultation } from "@/lib/consultations";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { logServerEvent } from "@/lib/logging";
import { assertWritable, getViewAsContext, ViewAsError } from "@/lib/viewAs";

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

export async function GET(request: Request) {
  try {
    const context = await getViewAsContext(request);
    const supabase =
      context.actualDoctor.isDevBypass || context.isViewAs
        ? getServiceRoleClient()
        : await createServerSupabaseClient();
    const dbOpts =
      context.actualDoctor.isDevBypass || context.isViewAs
        ? { doctorId: context.effectiveDoctor.id }
        : {};
    const records = await listConsultations(supabase, dbOpts);
    return NextResponse.json({ records });
  } catch (error) {
    if (error instanceof ViewAsError) {
      return apiError(error.status, error.code, error.message);
    }
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
    const context = await getViewAsContext(request);
    const blocked = assertWritable(context);
    if (blocked) return blocked;

    const supabase = context.actualDoctor.isDevBypass
      ? getServiceRoleClient()
      : await createServerSupabaseClient();
    const dbOpts = context.actualDoctor.isDevBypass ? { doctorId: context.actualDoctor.id } : {};

    const body = (await request.json()) as {
      consultationName?: unknown;
      caseId?: unknown;
      relatedCaseId?: unknown;
      formData?: unknown;
      analysisResult?: unknown;
      analysisRaw?: unknown;
      modelMeta?: unknown;
      analysisStatus?: unknown;
    };

    const record = await createConsultation(supabase, {
      doctorId: context.actualDoctor.id,
      doctorEmail: context.actualDoctor.email,
      consultationName: normalizeName(body.consultationName),
      caseId: normalizeCaseId(body.caseId),
      relatedCaseId: normalizeCaseId(body.relatedCaseId),
      formData: body.formData ?? null,
    });

    if (body.analysisStatus === "analyzed") {
      const saved = await updateConsultation(
        supabase,
        record.id,
        {
          analysis_result: body.analysisResult ?? null,
          analysis_raw: body.analysisRaw ?? null,
          model_meta: body.modelMeta ?? null,
          analysis_status: "analyzed",
          analyzed_at: new Date().toISOString(),
        },
        dbOpts,
      );
      return NextResponse.json({ record: saved });
    }

    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof ViewAsError) {
      return apiError(error.status, error.code, error.message);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }
    if (error instanceof Error && error.message === "CASE_ID_TOO_LONG") {
      return apiError(400, "CASE_ID_TOO_LONG", "病案编号与随访记录编号不能超过64个字符。");
    }

    await logServerEvent({
      source: "api/consultations",
      message: "建立病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "建立病案记录失败。");
  }
}
