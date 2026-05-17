import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

// Returns the 10 most recent global prompt-quality runs.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("analytics_prompt_quality_runs")
    .select("id,window_start,window_end,stats,narrative,created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return apiError(500, "INTERNAL_ERROR", "读取分析数据失败。");

  return NextResponse.json({ runs: data ?? [] });
}
