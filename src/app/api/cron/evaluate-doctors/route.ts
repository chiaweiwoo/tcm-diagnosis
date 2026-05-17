/**
 * Nightly evaluation cron — runs Goal 1 (AI output review) + Goal 2 (doctor profile)
 * for all active doctors over the past 7 days.
 *
 * Called by GitHub Actions after analytics-daily (same schedule: 02:00 CST).
 * Smart skip: if a doctor already has an evaluation for today's window, skip them.
 *
 * Auth: x-cron-secret header must match CRON_SECRET env var.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import { evaluateDoctor } from "@/lib/analytics/evaluation";
import { buildWindow } from "@/lib/analytics/stats";

// Each doctor = 1 DeepSeek call; allow enough for ~20 doctors in parallel
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError(500, "INTERNAL_ERROR", "CRON_SECRET 未配置。");
  if (req.headers.get("x-cron-secret") !== secret) {
    return apiError(401, "UNAUTHORIZED", "无效的 cron 密钥。");
  }

  const admin = getServiceRoleClient();
  const { windowStart, windowEnd } = buildWindow(7);

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

  const results = await Promise.allSettled(
    doctors.map(async (doctor) => {
      // Smart skip: already evaluated this window
      const { data: existing } = await admin
        .from("analytics_doctor_evaluations")
        .select("id")
        .eq("doctor_id", doctor.doctorId)
        .eq("window_start", windowStart.toISOString())
        .eq("window_end", windowEnd.toISOString())
        .maybeSingle();

      if (existing) return { skipped: true };

      const { evaluation, consultationCount, model } = await evaluateDoctor(
        admin,
        doctor.doctorId,
        7,
      );

      await admin
        .from("analytics_doctor_evaluations")
        .upsert(
          {
            doctor_id: doctor.doctorId,
            window_start: windowStart.toISOString(),
            window_end: windowEnd.toISOString(),
            consultation_count: consultationCount,
            output_review: evaluation.outputReview,
            doctor_profile: evaluation.doctorProfile,
            model,
          },
          { onConflict: "doctor_id,window_start,window_end" },
        );

      return { skipped: false };
    }),
  );

  let processed = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") r.value.skipped ? skipped++ : processed++;
    else failed++;
  }

  return NextResponse.json({ ok: true, processed, skipped, failed });
}
