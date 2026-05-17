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
  const cronSecret   = process.env.CRON_SECRET;
  const assessSecret = process.env.ASSESSMENT_API_KEY;

  const givenCron   = req.headers.get("x-cron-secret");
  const givenAssess = req.headers.get("x-assessment-key");

  const authed =
    (cronSecret   && givenCron   === cronSecret)   ||
    (assessSecret && givenAssess === assessSecret);

  if (!authed) return apiError(401, "UNAUTHORIZED", "无效的密钥。");

  // Optional body: { doctorEmail?: string, force?: boolean }
  let targetEmail: string | null = null;
  let force = false;
  try {
    const body = await req.json() as { doctorEmail?: string; force?: boolean };
    if (typeof body.doctorEmail === "string" && body.doctorEmail.trim()) {
      targetEmail = body.doctorEmail.trim().toLowerCase();
    }
    if (body.force === true) force = true;
  } catch { /* no body — run all */ }

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

  let doctors = (allowlistResult.data ?? [])
    .map((row) => ({
      email: row.email.toLowerCase(),
      doctorId: emailToId.get(row.email.toLowerCase()),
    }))
    .filter((d): d is { email: string; doctorId: string } => Boolean(d.doctorId));

  if (targetEmail) {
    doctors = doctors.filter((d) => d.email === targetEmail);
    if (doctors.length === 0) {
      return apiError(404, "NOT_FOUND", `找不到医生：${targetEmail}`);
    }
  }

  const results = await Promise.allSettled(
    doctors.map(async (doctor) => {
      // Smart skip: already evaluated this window (bypass with force=true)
      if (!force) {
        const { data: existing } = await admin
          .from("analytics_doctor_evaluations")
          .select("id")
          .eq("doctor_id", doctor.doctorId)
          .eq("window_start", windowStart.toISOString())
          .eq("window_end", windowEnd.toISOString())
          .maybeSingle();

        if (existing) return { skipped: true };
      }

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
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") r.value.skipped ? skipped++ : processed++;
    else {
      failed++;
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }

  return NextResponse.json({ ok: true, processed, skipped, failed, errors });
}
