import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { getCurrentDoctor } from "@/lib/currentDoctor";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";

// Returns the latest analytics run for the calling doctor (RLS-enforced).
export async function GET() {
  try {
    const doctor = await getCurrentDoctor();

    // Use the appropriate client (dev bypass uses service_role)
    const client = doctor.isDevBypass ? getServiceRoleClient() : await createServerSupabaseClient();

    const query = client
      .from("analytics_doctor_dashboard")
      .select(
        "usage_run_id,window_start,window_end,usage_stats,usage_narrative,performance_stats,performance_narrative,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1);

    // In dev bypass mode, scope explicitly since RLS is bypassed
    const { data, error } = await (doctor.isDevBypass
      ? query.eq("doctor_id", doctor.id)
      : query
    ).maybeSingle();

    if (error) return apiError(500, "INTERNAL_ERROR", "读取分析数据失败。");

    return NextResponse.json({ run: data ?? null });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }
    return apiError(500, "INTERNAL_ERROR", "读取分析数据失败。");
  }
}
