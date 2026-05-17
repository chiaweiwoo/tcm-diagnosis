/**
 * Session review routes — fleet-wide AI output review for prompt refinement.
 *
 * GET  — list recent session reviews (newest first)
 * POST — trigger a new session review (optionally chained to a prior review)
 */

import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { reviewSession } from "@/lib/analytics/sessionReview";
import { logServerEvent } from "@/lib/logging";

// Session review involves a large DeepSeek call with up to 40 cases
export const maxDuration = 120;

async function guardAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) return null;
  return user;
}

// ---------------------------------------------------------------------------
// GET — list recent session reviews
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("analytics_session_reviews")
    .select("id,created_at,window_start,window_end,prior_review_id,prompt_version_at_run,sample_size,model,review")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return apiError(500, "INTERNAL_ERROR", "读取审查记录失败。");

  return NextResponse.json({ reviews: data ?? [] });
}

// ---------------------------------------------------------------------------
// POST — trigger new session review
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  let priorReviewId: string | null = null;
  let includePrior = true;
  try {
    const body = await req.json() as { priorReviewId?: string; includePrior?: boolean };
    if (typeof body.priorReviewId === "string" && body.priorReviewId.trim()) {
      priorReviewId = body.priorReviewId.trim();
    }
    if (body.includePrior === false) includePrior = false;
  } catch { /* no body */ }

  const admin = getServiceRoleClient();

  try {
    const row = await reviewSession({
      client: admin,
      priorReviewId: includePrior ? priorReviewId : null,
    });

    return NextResponse.json({ ok: true, review: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("无已分析病案")) {
      return apiError(400, "NO_CONSULTATIONS", message);
    }

    await logServerEvent({
      source: "api/admin/analytics/session-review",
      message: "提示词审查失败。",
      details: { error: message },
    });

    return apiError(500, "INTERNAL_ERROR", "审查生成失败，请稍后重试。");
  }
}
