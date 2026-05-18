/**
 * Bulk doctor evaluation endpoint — runs doctor profile (Goal 2)
 * for all active doctors or a single doctor over the past 14 days.
 *
 * Triggered via GH Actions workflow_dispatch (manual only — no schedule).
 * Auth: x-assessment-key header must match ASSESSMENT_API_KEY env var.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import { evaluateDoctor, NoConsultationsError } from "@/lib/analytics/evaluation";
import { buildWindow } from "@/lib/analytics/stats";

// Each doctor = 1 DeepSeek call; allow enough for ~20 doctors in parallel
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const assessSecret = process.env.ASSESSMENT_API_KEY;
  const givenAssess  = req.headers.get("x-assessment-key");

  if (!assessSecret || givenAssess !== assessSecret) {
    return apiError(401, "UNAUTHORIZED", "无效的密钥。");
  }

  // Optional body: { doctorId?: string } or { doctorEmail?: string }
  // doctorId takes precedence if both are provided.
  let targetId: string | null = null;
  let targetEmail: string | null = null;
  try {
    const body = await req.json() as { doctorId?: string; doctorEmail?: string };
    if (typeof body.doctorId === "string" && body.doctorId.trim()) {
      targetId = body.doctorId.trim();
    } else if (typeof body.doctorEmail === "string" && body.doctorEmail.trim()) {
      targetEmail = body.doctorEmail.trim().toLowerCase();
    }
  } catch { /* no body — run all */ }

  const admin = getServiceRoleClient();
  const windowDays = 14;
  const { windowStart, windowEnd } = buildWindow(windowDays);

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

  if (targetId) {
    doctors = doctors.filter((d) => d.doctorId === targetId);
    if (doctors.length === 0) {
      return apiError(404, "NOT_FOUND", `找不到医生：${targetId}`);
    }
  } else if (targetEmail) {
    doctors = doctors.filter((d) => d.email === targetEmail);
    if (doctors.length === 0) {
      return apiError(404, "NOT_FOUND", `找不到医生：${targetEmail}`);
    }
  }

  const results = await Promise.allSettled(
    doctors.map(async (doctor) => {
      try {
        const { evaluation, consultationCount, model } = await evaluateDoctor(
          admin,
          doctor.doctorId,
          windowDays,
        );

        await admin
          .from("analytics_doctor_evaluations")
          .insert({
            doctor_id:          doctor.doctorId,
            window_start:       windowStart.toISOString(),
            window_end:         windowEnd.toISOString(),
            consultation_count: consultationCount,
            doctor_profile:     evaluation.doctorProfile,
            model,
          });

        return { skipped: false };
      } catch (err) {
        // No consultations in window — skip silently, don't count as failure
        if (err instanceof NoConsultationsError) {
          return { skipped: true };
        }
        throw err;
      }
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
