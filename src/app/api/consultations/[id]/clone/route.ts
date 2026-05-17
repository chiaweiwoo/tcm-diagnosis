import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { getCurrentDoctor } from "@/lib/currentDoctor";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { logServerEvent } from "@/lib/logging";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const doctor = await getCurrentDoctor();
    if (!(await isAdminDoctorEmail(doctor.email))) {
      return apiError(403, "UNAUTHORIZED", "仅管理员可克隆病案。");
    }

    const { id } = await context.params;
    const admin = getServiceRoleClient();

    // Read source consultation (service_role bypasses RLS — admin can read any doctor's record)
    const { data: source, error: readError } = await admin
      .from("consultations")
      .select("form_data,doctor_email")
      .eq("id", id)
      .maybeSingle();

    if (readError) throw readError;
    if (!source) return apiError(404, "NOT_FOUND", "找不到原始病案记录。");

    // Insert new consultation under the admin's own account, form_data only
    const { data: newRecord, error: insertError } = await admin
      .from("consultations")
      .insert({
        doctor_id: doctor.id,
        doctor_email: doctor.email,
        form_data: source.form_data,
        analysis_status: "draft",
        model_meta: { cloned_from_doctor_email: source.doctor_email },
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ id: newRecord.id });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }
    await logServerEvent({
      source: "api/consultations/[id]/clone",
      message: "克隆病案记录失败。",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, "INTERNAL_ERROR", "克隆病案记录失败。");
  }
}
