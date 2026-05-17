/**
 * Daily analytics cron endpoint — Sprint 5.
 *
 * Called by GitHub Actions on schedule (0 18 * * * UTC = 02:00 CST).
 * Also callable on-demand via workflow_dispatch.
 *
 * Auth: CRON_SECRET header must match the CRON_SECRET env var.
 * This is NOT a doctor-facing route — no Supabase session required.
 *
 * Smart skip: per doctor, skip narrative re-generation if their last
 * analytics_usage_runs row has a window_end matching today's window
 * AND a non-null narrative. This keeps cost proportional to activity.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import {
  buildWindow,
  computePromptQualityStats,
  computeUsageStats,
  computePerformanceStats,
} from "@/lib/analytics/stats";
import {
  generateUsageNarrative,
  generatePerformanceNarrative,
  generatePromptQualityNarrative,
} from "@/lib/analytics/narrative";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Auth — accepts either x-cron-secret (CRON_SECRET) or X-Assessment-Key (ASSESSMENT_API_KEY)
  const cronSecret   = process.env.CRON_SECRET;
  const assessSecret = process.env.ASSESSMENT_API_KEY;
  const authed =
    (cronSecret   && req.headers.get("x-cron-secret")    === cronSecret)   ||
    (assessSecret && req.headers.get("x-assessment-key") === assessSecret);
  if (!authed) return apiError(401, "UNAUTHORIZED", "无效的密钥。");

  const admin = getServiceRoleClient();

  // Resolve all active doctors
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

  const { windowStart: usageStart, windowEnd: usageEnd } = buildWindow(30);
  const { windowStart: qualityStart, windowEnd: qualityEnd } = buildWindow(7);

  let doctorsProcessed = 0;
  let doctorsSkipped = 0;
  let doctorsFailed = 0;

  for (const doctor of doctors) {
    try {
      // Smart skip: check if this doctor already has a narrative for today's window
      const { data: existing } = await admin
        .from("analytics_usage_runs")
        .select("narrative")
        .eq("doctor_id", doctor.doctorId)
        .eq("window_end", usageEnd.toISOString())
        .maybeSingle();

      if (existing?.narrative) {
        doctorsSkipped++;
        continue;
      }

      const [usage, performance] = await Promise.all([
        computeUsageStats(admin, doctor.doctorId, usageStart, usageEnd),
        computePerformanceStats(admin, doctor.doctorId, usageStart, usageEnd),
      ]);

      if (usage.consultationCount === 0) continue;

      const [usageNarrative, performanceNarrative] = await Promise.allSettled([
        generateUsageNarrative(usage, doctor.email),
        generatePerformanceNarrative(performance, doctor.email),
      ]);

      await Promise.all([
        admin.from("analytics_usage_runs").upsert(
          {
            doctor_id: doctor.doctorId,
            window_start: usageStart.toISOString(),
            window_end: usageEnd.toISOString(),
            stats: usage,
            narrative:
              usageNarrative.status === "fulfilled" ? usageNarrative.value : null,
          },
          { onConflict: "doctor_id,window_start,window_end" },
        ),
        admin.from("analytics_performance_runs").upsert(
          {
            doctor_id: doctor.doctorId,
            window_start: usageStart.toISOString(),
            window_end: usageEnd.toISOString(),
            stats: performance,
            narrative:
              performanceNarrative.status === "fulfilled"
                ? performanceNarrative.value
                : null,
          },
          { onConflict: "doctor_id,window_start,window_end" },
        ),
      ]);

      doctorsProcessed++;
    } catch {
      doctorsFailed++;
    }
  }

  // Global quality stats
  let qualityRunId: string | null = null;
  try {
    const qualityStats = await computePromptQualityStats(admin, qualityStart, qualityEnd);

    let qualityNarrative: string | null = null;
    try {
      qualityNarrative = await generatePromptQualityNarrative(qualityStats);
    } catch {
      // non-fatal
    }

    const { data: qualityRow } = await admin
      .from("analytics_prompt_quality_runs")
      .upsert(
        {
          window_start: qualityStart.toISOString(),
          window_end: qualityEnd.toISOString(),
          stats: qualityStats,
          narrative: qualityNarrative,
        },
        { onConflict: "window_start,window_end" },
      )
      .select("id")
      .single();

    qualityRunId = qualityRow?.id ?? null;
  } catch {
    // non-fatal
  }

  return NextResponse.json({
    ok: true,
    doctorsProcessed,
    doctorsSkipped,
    doctorsFailed,
    qualityRunId,
  });
}
