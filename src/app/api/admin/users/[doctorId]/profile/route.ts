import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { computeDoctorProfile, findFlaggedCases } from "@/lib/analytics/doctorProfile";

type RouteContext = { params: Promise<{ doctorId: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  const { doctorId } = await params;
  const admin = getServiceRoleClient();

  const [snapshot, flagResult] = await Promise.all([
    computeDoctorProfile(admin, doctorId),
    findFlaggedCases(admin, doctorId),
  ]);

  return NextResponse.json({
    snapshot,
    flagged: flagResult.flagged,
    clusters: flagResult.clusters,
  });
}
