import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import {
  buildWindow,
  computePromptQualityStats,
  computeUsageStats,
  computePerformanceStats,
} from "@/lib/analytics/stats";

// Allow up to 60 s for cross-doctor computation on Vercel Pro
export const maxDuration = 60;

export async function POST(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可运行分析。");
  }

  const admin = getServiceRoleClient();

  // ---------------------------------------------------------------------------
  // Resolve all active doctors
  // ---------------------------------------------------------------------------
  const [allowlistResult, usersResult] = await Promise.all([
    admin.from("doctor_allowlist").select("email").eq("is_active", true),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (allowlistResult.error || usersResult.error) {
    return apiError(500, "INTERNAL_ERROR", "无法读取用户列表。");
  }

  const emailToId = new Map(
    usersResult.data.users.map((u) => [u.email?.toLowerCase() ?? "", u.id]),
  );
  const doctors = (allowlistResult.data ?? [])
    .map((row) => ({
      email: row.email.toLowerCase(),
      doctorId: emailToId.get(row.email.toLowerCase()),
    }))
    .filter((d): d is { email: string; doctorId: string } => Boolean(d.doctorId));

  // ---------------------------------------------------------------------------
  // Compute windows
  // ---------------------------------------------------------------------------
  const { windowStart: usageStart, windowEnd: usageEnd } = buildWindow(30);
  const { windowStart: qualityStart, windowEnd: qualityEnd } = buildWindow(7);

  // ---------------------------------------------------------------------------
  // Per-doctor stats
  // ---------------------------------------------------------------------------
  let doctorsProcessed = 0;
  let doctorsFailed = 0;

  for (const doctor of doctors) {
    try {
      const [usage, performance] = await Promise.all([
        computeUsageStats(admin, doctor.doctorId, usageStart, usageEnd),
        computePerformanceStats(admin, doctor.doctorId, usageStart, usageEnd),
      ]);

      // Skip doctors with no consultations in window
      if (usage.consultationCount === 0) continue;

      await Promise.all([
        admin.from("analytics_usage_runs").upsert(
          {
            doctor_id: doctor.doctorId,
            window_start: usageStart.toISOString(),
            window_end: usageEnd.toISOString(),
            stats: usage,
          },
          { onConflict: "doctor_id,window_start,window_end" },
        ),
        admin.from("analytics_performance_runs").upsert(
          {
            doctor_id: doctor.doctorId,
            window_start: usageStart.toISOString(),
            window_end: usageEnd.toISOString(),
            stats: performance,
          },
          { onConflict: "doctor_id,window_start,window_end" },
        ),
      ]);

      doctorsProcessed++;
    } catch {
      doctorsFailed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Global prompt quality stats
  // ---------------------------------------------------------------------------
  let qualityRunId: string | null = null;

  try {
    const qualityStats = await computePromptQualityStats(admin, qualityStart, qualityEnd);

    const { data: qualityRow } = await admin
      .from("analytics_prompt_quality_runs")
      .upsert(
        {
          window_start: qualityStart.toISOString(),
          window_end: qualityEnd.toISOString(),
          stats: qualityStats,
        },
        { onConflict: "window_start,window_end" },
      )
      .select("id")
      .single();

    qualityRunId = qualityRow?.id ?? null;
  } catch {
    // non-fatal — per-doctor stats are still useful
  }

  return NextResponse.json({
    ok: true,
    doctorsProcessed,
    doctorsFailed,
    qualityRunId,
    windows: {
      usage: { start: usageStart, end: usageEnd },
      quality: { start: qualityStart, end: qualityEnd },
    },
  });
}
