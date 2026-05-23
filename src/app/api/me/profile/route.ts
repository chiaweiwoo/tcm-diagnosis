import { NextResponse } from "next/server";
import { normalizeDoctorProfile } from "@/lib/analytics/evaluation";
import { apiError } from "@/lib/apiResponses";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getViewAsContext, ViewAsError } from "@/lib/viewAs";

export async function GET(request: Request) {
  try {
    const viewAs = await getViewAsContext(request);
    const admin = getServiceRoleClient();

    const { data, error } = await admin
      .from("analytics_doctor_evaluations")
      .select("id, doctor_profile, created_at")
      .eq("doctor_id", viewAs.effectiveDoctor.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return apiError(500, "INTERNAL_ERROR", "读取评估记录失败。");
    }

    const cacheHeaders = {
      "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
    };

    if (!data) {
      return NextResponse.json({ profile: null }, { headers: cacheHeaders });
    }

    const profile = normalizeDoctorProfile(data.doctor_profile as Record<string, unknown>);
    const descriptive = {
      profileSummary: profile.profileSummary,
      keyObservations: profile.keyObservations,
      treatmentStyle: profile.treatmentStyle,
      aiRecurringThemes: profile.aiRecurringThemes.map(({ theme, frequency }) => ({
        theme,
        frequency,
      })),
      evaluatedAt: data.created_at as string,
    };

    return NextResponse.json({ profile: descriptive }, { headers: cacheHeaders });
  } catch (error) {
    if (error instanceof ViewAsError) {
      return apiError(error.status, error.code, error.message);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }
    return apiError(500, "INTERNAL_ERROR", "读取评估记录失败。");
  }
}
