import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { evaluateDoctor, insertDoctorEvaluation, NoConsultationsError } from "@/lib/analytics/evaluation";
import { logServerEvent } from "@/lib/logging";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ doctorId: string }> };

async function guardAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) return null;
  return user;
}

function cleanWindowDays(value: unknown) {
  return typeof value === "number" && value > 0 && value <= 90 ? value : 7;
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

  return NextResponse.json(
    { evaluation: data ?? null },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      },
    }
  );
}

// ---------------------------------------------------------------------------
// POST — trigger new evaluation for a doctor
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, context: RouteContext) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const { doctorId } = await context.params;
  const admin = getServiceRoleClient();

  let windowDays = 7;
  try {
    const body = await req.json() as { windowDays?: number };
    windowDays = cleanWindowDays(body.windowDays);
  } catch {
    // no body — use default
  }

  try {
    const { evaluation, consultationCount, model } = await evaluateDoctor(
      admin,
      doctorId,
      windowDays,
    );

    const evaluationId = await insertDoctorEvaluation({
      client: admin,
      doctorId,
      windowDays,
      evaluation,
      consultationCount,
      model,
    });

    return NextResponse.json({
      ok: true,
      evaluationId,
      consultationCount,
    });
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
