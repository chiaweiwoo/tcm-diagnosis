import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { evaluateDoctor, NoConsultationsError } from "@/lib/analytics/evaluation";
import { buildWindow } from "@/lib/analytics/stats";
import { logServerEvent } from "@/lib/logging";

// Evaluation calls DeepSeek with up to ~20 consultations — allow 60s
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
    .select("id,window_start,window_end,consultation_count,doctor_profile,model,created_at")
    .eq("doctor_id", doctorId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", "读取评估记录失败。");

  return NextResponse.json({ evaluation: data ?? null });
}

// ---------------------------------------------------------------------------
// POST — trigger new evaluation for a doctor (append-only, 14-day window)
// ---------------------------------------------------------------------------

export async function POST(_req: NextRequest, context: RouteContext) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const { doctorId } = await context.params;
  const admin = getServiceRoleClient();
  const windowDays = 14;

  try {
    const { evaluation, consultationCount, model } = await evaluateDoctor(
      admin,
      doctorId,
      windowDays,
    );

    const { windowStart, windowEnd } = buildWindow(windowDays);

    const { data: saved, error: saveError } = await admin
      .from("analytics_doctor_evaluations")
      .insert({
        doctor_id:          doctorId,
        window_start:       windowStart.toISOString(),
        window_end:         windowEnd.toISOString(),
        consultation_count: consultationCount,
        doctor_profile:     evaluation.doctorProfile,
        model,
      })
      .select("id,window_start,window_end,consultation_count,doctor_profile,model,created_at")
      .single();

    if (saveError) throw new Error(saveError.message);

    return NextResponse.json({ ok: true, evaluation: saved });
  } catch (err) {
    if (err instanceof NoConsultationsError) {
      return apiError(400, "NO_CONSULTATIONS", err.message);
    }

    const message = err instanceof Error ? err.message : String(err);
    await logServerEvent({
      source: "api/admin/analytics/evaluate/[doctorId]",
      message: "医生评估失败。",
      details: { error: message, doctorId },
    });

    return apiError(500, "INTERNAL_ERROR", "评估生成失败，请稍后重试。");
  }
}
