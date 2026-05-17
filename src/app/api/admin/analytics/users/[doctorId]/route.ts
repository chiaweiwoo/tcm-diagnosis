import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

type RouteContext = { params: Promise<{ doctorId: string }> };

// Returns the latest usage + performance run for a doctor from the dashboard view.
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
    .from("analytics_doctor_dashboard")
    .select(
      "usage_run_id,doctor_id,window_start,window_end,usage_stats,usage_narrative,performance_stats,performance_narrative,created_at",
    )
    .eq("doctor_id", doctorId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", "读取分析数据失败。");

  return NextResponse.json({ run: data ?? null });
}
