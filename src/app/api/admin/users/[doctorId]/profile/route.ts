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

  // Check current MAX(analyzed_at) for this doctor
  const { data: latestRow } = await admin
    .from("consultations")
    .select("analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .single();

  const currentMax = latestRow?.analyzed_at ?? null;

  // Try cache — valid if source_last_record_at matches current max
  if (currentMax) {
    const { data: cached } = await admin
      .from("doctor_profile_snapshots")
      .select("snapshot, flagged, clusters, source_last_record_at")
      .eq("doctor_id", doctorId)
      .single();

    if (cached && cached.source_last_record_at === currentMax) {
      return NextResponse.json({
        snapshot: cached.snapshot,
        flagged: cached.flagged,
        clusters: cached.clusters,
      });
    }
  }

  // Cache miss — compute fresh
  const [snapshot, flagResult] = await Promise.all([
    computeDoctorProfile(admin, doctorId),
    findFlaggedCases(admin, doctorId),
  ]);

  // Persist to cache (best-effort)
  if (currentMax) {
    try {
      await admin
        .from("doctor_profile_snapshots")
        .upsert(
          {
            doctor_id: doctorId,
            snapshot,
            flagged: flagResult.flagged,
            clusters: flagResult.clusters,
            source_last_record_at: currentMax,
            computed_at: new Date().toISOString(),
          },
          { onConflict: "doctor_id" },
        );
    } catch {
      // cache write failure is non-fatal
    }
  }

  return NextResponse.json({
    snapshot,
    flagged: flagResult.flagged,
    clusters: flagResult.clusters,
  });
}
