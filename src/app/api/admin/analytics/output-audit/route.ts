/**
 * AI Output Audit routes — fleet-wide AI output review (Goal 1 v3).
 *
 * GET  — list recent audits (newest first)
 * POST — trigger a new audit
 */

import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { runOutputAudit } from "@/lib/analytics/outputAudit";
import { logServerEvent } from "@/lib/logging";

// Up to 100 cases + feedback corpus — allow generous time
export const maxDuration = 120;

async function guardAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) return null;
  return user;
}

// ---------------------------------------------------------------------------
// GET — list recent audits
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("analytics_output_audits")
    .select("id,created_at,window_start,window_end,prior_review_id,prompt_version_at_run,sample_size,model,review")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return apiError(500, "INTERNAL_ERROR", "读取审查记录失败。");

  return NextResponse.json({ audits: data ?? [] });
}

// ---------------------------------------------------------------------------
// POST — trigger new output audit
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const user = await guardAdmin();
  if (!user) return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");

  const admin = getServiceRoleClient();

  let windowDays = 14;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.windowDays === "number" && body.windowDays > 0) {
      windowDays = body.windowDays;
    }
  } catch { /* no body */ }

  try {
    const row = await runOutputAudit({ client: admin, windowDays });

    return NextResponse.json({ ok: true, audit: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("无已分析病案")) {
      return apiError(400, "NO_CONSULTATIONS", message);
    }

    await logServerEvent({
      source: "api/admin/analytics/output-audit",
      message: "AI 输出审查失败。",
      details: { error: message },
    });

    return apiError(500, "INTERNAL_ERROR", "审查生成失败，请稍后重试。");
  }
}
