import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

type RouteContext = { params: Promise<{ doctorId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  const { doctorId } = await context.params;
  const admin = getServiceRoleClient();

  const { data, error } = await admin
    .from("consultations")
    .select(
      "id,doctor_id,doctor_email,consultation_name,form_data,analysis_result,analysis_status,created_at,updated_at,analyzed_at,model_meta",
    )
    .eq("doctor_id", doctorId)
    .order("updated_at", { ascending: false });

  if (error) return apiError(500, "INTERNAL_ERROR", "读取病案历史失败。");

  return NextResponse.json({ records: data ?? [] });
}
