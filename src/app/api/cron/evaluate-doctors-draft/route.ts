/**
 * Experimental doctor-review draft endpoint.
 *
 * This route is intentionally read-only: it fetches analyzed consultations,
 * runs the Flash + Pro draft pipeline, and returns the draft for GitHub
 * workflow inspection without inserting analytics rows.
 */

import { type NextRequest, NextResponse } from "next/server";
import { DeepSeekError } from "@/lib/ai/deepseek";
import { runDoctorReviewDraft, type DoctorReviewDraftRow } from "@/lib/analytics/doctorReviewDraft";
import { buildWindow } from "@/lib/analytics/stats";
import { apiError } from "@/lib/apiResponses";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;

type DraftRequest = {
  doctorEmail?: string;
  windowDays?: number;
  mode?: "medical_profile_v2";
};

function cleanWindowDays(value: unknown) {
  return typeof value === "number" && value > 0 && value <= 90 ? value : 14;
}

function safeDeepSeekDetails(error: DeepSeekError) {
  return Object.fromEntries(
    Object.entries({
      status: error.status,
      ...(error.details ?? {}),
    }).filter(([key]) => !key.toLowerCase().includes("snippet")),
  );
}

async function resolveDoctorId(doctorEmail: string): Promise<string | null> {
  const admin = getServiceRoleClient();
  const normalizedEmail = doctorEmail.trim().toLowerCase();

  const [allowlistResult, usersResult] = await Promise.all([
    admin
      .from("doctor_allowlist")
      .select("email")
      .eq("is_active", true)
      .ilike("email", normalizedEmail)
      .maybeSingle(),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (allowlistResult.error) throw new Error(allowlistResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);
  if (!allowlistResult.data?.email) return null;

  return usersResult.data.users.find((user) => user.email?.toLowerCase() === normalizedEmail)?.id ?? null;
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.ASSESSMENT_API_KEY;
  if (!expectedKey) {
    return apiError(500, "INTERNAL_ERROR", "ASSESSMENT_API_KEY is not configured.");
  }
  if (req.headers.get("X-Assessment-Key") !== expectedKey) {
    return apiError(401, "UNAUTHORIZED", "Invalid assessment key.");
  }

  let body: DraftRequest = {};
  try {
    body = await req.json() as DraftRequest;
  } catch {
    body = {};
  }

  const doctorEmail = body.doctorEmail?.trim().toLowerCase();
  if (!doctorEmail) {
    return apiError(400, "INVALID_INPUT", "doctorEmail is required for draft evaluation.");
  }
  if (body.mode && body.mode !== "medical_profile_v2") {
    return apiError(400, "INVALID_INPUT", "Unsupported draft evaluation mode.");
  }

  const windowDays = cleanWindowDays(body.windowDays);
  const admin = getServiceRoleClient();

  let doctorId: string | null;
  try {
    doctorId = await resolveDoctorId(doctorEmail);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      stage: "resolve_doctor",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }

  if (!doctorId) {
    return NextResponse.json({
      ok: false,
      stage: "resolve_doctor",
      message: "Requested doctor was not active or not found.",
      doctorEmail,
    }, { status: 404 });
  }

  const { windowStart, windowEnd } = buildWindow(windowDays);
  const { data, error } = await admin
    .from("consultations")
    .select("form_data,analysis_result,analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lt("analyzed_at", windowEnd.toISOString())
    .order("analyzed_at", { ascending: true });

  if (error) {
    return NextResponse.json({
      ok: false,
      stage: "fetch_consultations",
      message: error.message,
      doctorEmail,
      windowDays,
    }, { status: 500 });
  }

  const rows = (data ?? []) as DoctorReviewDraftRow[];
  if (rows.length === 0) {
    return NextResponse.json({
      ok: false,
      stage: "fetch_consultations",
      message: "No analyzed consultations found in the requested window.",
      doctorEmail,
      windowDays,
      recordCount: 0,
    }, { status: 400 });
  }

  try {
    const result = await runDoctorReviewDraft({ rows, windowDays });
    return NextResponse.json({
      ...result,
      doctorEmail,
      doctorId,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      stage: error instanceof DeepSeekError ? "deepseek" : "draft_pipeline",
      message: error instanceof Error ? error.message : String(error),
      doctorEmail,
      windowDays,
      recordCount: rows.length,
      details: error instanceof DeepSeekError ? safeDeepSeekDetails(error) : undefined,
    }, { status: 500 });
  }
}
