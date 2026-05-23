import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { logServerEvent } from "@/lib/logging";
import { assertWritable, getViewAsContext, ViewAsError } from "@/lib/viewAs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const viewAs = await getViewAsContext(request);
    const blocked = assertWritable(viewAs);
    if (blocked) return blocked;

    if (!(await isAdminDoctorEmail(viewAs.actualDoctor.email))) {
      return apiError(403, "UNAUTHORIZED", "仅管理员可拷贝病案。");
    }

    const { id } = await context.params;
    const admin = getServiceRoleClient();

    const { data: source, error: readError } = await admin
      .from("consultations")
      .select("form_data,analysis_result,analysis_raw,model_meta,analysis_status,analyzed_at,case_id,related_case_id,doctor_email")
      .eq("id", id)
      .maybeSingle();

    if (readError) throw readError;
    if (!source) return apiError(404, "NOT_FOUND", "找不到原始病案记录。");

    const now = new Date().toISOString();

    const { data: newRecord, error: insertError } = await admin
      .from("consultations")
      .insert({
        doctor_id: viewAs.actualDoctor.id,
        doctor_email: viewAs.actualDoctor.email,
        form_data: source.form_data,
        analysis_result: source.analysis_result ?? null,
        analysis_raw: source.analysis_raw ?? null,
        analysis_status: source.analysis_status ?? "draft",
        analyzed_at: source.analyzed_at ?? null,
        case_id: source.case_id ?? null,
        case_id_updated_at: source.case_id ? now : null,
        related_case_id: source.related_case_id ?? null,
        related_case_id_updated_at: source.related_case_id ? now : null,
        analysis_stale: false,
        model_meta: { ...((source.model_meta as object | null) ?? {}), cloned_from_doctor_email: source.doctor_email },
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ id: newRecord.id });
  } catch (error) {
    if (error instanceof ViewAsError) {
      return apiError(error.status, error.code, error.message);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }
    await logServerEvent({
      source: "api/consultations/[id]/clone",
      message: "拷贝病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "拷贝病案记录失败。");
  }
}
