import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

type RouteContext = { params: Promise<{ doctorId: string }> };

/**
 * GET /api/admin/analytics/evaluate/[doctorId]/timeseries
 *
 * Returns lightweight consultation date data for the time-series bar chart.
 * Only selects the timestamp column — no clinical content.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  const { doctorId } = await context.params;
  const admin = getServiceRoleClient();

  // Optimization: only fetch records from the last 35 days to keep the payload small and query fast.
  // 35 days gives us a safe margin for the 30-day chart across different timezones.
  const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 86400000).toISOString();

  const { data, error } = await admin
    .from("consultations")
    .select("analyzed_at,created_at")
    .eq("doctor_id", doctorId)
    .or(`analyzed_at.gte.${thirtyFiveDaysAgo},created_at.gte.${thirtyFiveDaysAgo}`)
    .order("created_at", { ascending: true });

  if (error) return apiError(500, "INTERNAL_ERROR", "读取病案时序数据失败。");

  // Return just the timestamps; analyzed_at is preferred (reflects actual AI usage)
  const dates = (data ?? []).map((r) => r.analyzed_at ?? r.created_at);

  return NextResponse.json({ dates });
}
