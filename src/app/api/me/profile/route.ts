import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { normalizeDoctorProfile } from "@/lib/analytics/evaluation";
import { apiError } from "@/lib/apiResponses";

/**
 * GET /api/me/profile
 *
 * Returns the descriptive subset of the current doctor's latest evaluation.
 * Strips analytical fields (strengths, gaps, guidancePoints) — those are
 * admin-only and never returned here.
 *
 * Cache: private, 5-minute freshness with stale-while-revalidate.
 * Profile only changes when an admin triggers a new evaluation run.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(401, "UNAUTHORIZED", "请先登录。");

  const admin = getServiceRoleClient();

  const { data, error } = await admin
    .from("analytics_doctor_evaluations")
    .select("id, doctor_profile, created_at")
    .eq("doctor_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", "读取评估记录失败。");

  const cacheHeaders = {
    "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
  };

  if (!data) {
    return NextResponse.json({ profile: null }, { headers: cacheHeaders });
  }

  const profile = normalizeDoctorProfile(data.doctor_profile as Record<string, unknown>);

  // Descriptive subset — analytical fields (strengths, gaps, guidancePoints) are stripped.
  const descriptive = {
    profileSummary: profile.profileSummary,
    keyObservations: profile.keyObservations,
    treatmentStyle: profile.treatmentStyle,
    // Strip caseNumbers — case-level granularity is not for doctor view.
    aiRecurringThemes: profile.aiRecurringThemes.map(({ theme, frequency }) => ({
      theme,
      frequency,
    })),
    evaluatedAt: data.created_at as string,
  };

  return NextResponse.json({ profile: descriptive }, { headers: cacheHeaders });
}
