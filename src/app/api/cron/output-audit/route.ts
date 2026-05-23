/**
 * Fleet-wide AI output audit endpoint (Goal 1 v3).
 * Triggered via GH Actions workflow_dispatch (manual only — no schedule).
 * Auth: x-assessment-key header must match ASSESSMENT_API_KEY env var.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import { runOutputAudit } from "@/lib/analytics/outputAudit";
import { logServerEvent } from "@/lib/logging";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const assessSecret = process.env.ASSESSMENT_API_KEY;
  const givenKey = req.headers.get("x-assessment-key");

  if (!assessSecret || givenKey !== assessSecret) {
    return apiError(401, "UNAUTHORIZED", "无效的密钥。");
  }

  const admin = getServiceRoleClient();

  let windowDays: number | undefined;
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
      source: "api/cron/output-audit",
      message: "AI 输出审查失败。",
      details: { error: message },
    });

    return apiError(500, "INTERNAL_ERROR", "审查生成失败，请稍后重试。");
  }
}
