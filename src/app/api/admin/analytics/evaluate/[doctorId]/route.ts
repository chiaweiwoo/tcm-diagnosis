import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { evaluateDoctor } from "@/lib/analytics/evaluation";
import { buildWindow } from "@/lib/analytics/stats";
import { logServerEvent } from "@/lib/logging";

// Evaluation calls DeepSeek with up to 10 consultations — allow 60s
export const maxDuration = 60;

type RouteContext = { params: Promise<{ doctorId: string }> };

async function guardAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) return null;
  return user;
}

// ---------------------------------------------------------------------------
// GET — fetch latest evaluation for a doctor
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const { doctorId } = await context.params;
  const admin = getServiceRoleClient();

  const { data, error } = await admin
    .from("analytics_doctor_evaluations")
    .select("id,window_start,window_end,consultation_count,output_review,doctor_profile,model,created_at")
    .eq("doctor_id", doctorId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", "读取评估记录失败。");

  return NextResponse.json({ evaluation: data ?? null });
}

// ---------------------------------------------------------------------------
// POST — trigger new evaluation for a doctor
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, context: RouteContext) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const { doctorId } = await context.params;

  // Optional: allow override of window days via body
  let windowDays = 7;
  try {
    const body = await req.json() as { windowDays?: number };
    if (typeof body.windowDays === "number" && body.windowDays > 0 && body.windowDays <= 90) {
      windowDays = body.windowDays;
    }
  } catch {
    // no body — use default
  }

  const admin = getServiceRoleClient();

  try {
    const { evaluation, consultationCount, model } = await evaluateDoctor(
      admin,
      doctorId,
      windowDays,
    );

    const { windowStart, windowEnd } = buildWindow(windowDays);

    const { data: saved } = await admin
      .from("analytics_doctor_evaluations")
      .upsert(
        {
          doctor_id: doctorId,
          window_start: windowStart.toISOString(),
          window_end: windowEnd.toISOString(),
          consultation_count: consultationCount,
          output_review: evaluation.outputReview,
          doctor_profile: evaluation.doctorProfile,
          model,
        },
        { onConflict: "doctor_id,window_start,window_end" },
      )
      .select("id")
      .single();

    return NextResponse.json({
      ok: true,
      evaluationId: saved?.id ?? null,
      consultationCount,
      verdict: evaluation.outputReview?.verdict ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("没有已分析的病案")) {
      return apiError(400, "INVALID_INPUT", message);
    }

    await logServerEvent({
      source: "api/admin/analytics/evaluate/[doctorId]",
      message: "医生评估失败。",
      details: { error: message, doctorId },
    });

    return apiError(500, "INTERNAL_ERROR", "评估生成失败，请稍后重试。");
  }
}
