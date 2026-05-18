/**
 * Fleet-wide session review endpoint — runs prompt quality audit (Goal 1)
 * across all doctors over the past 14 days.
 *
 * Triggered via GH Actions workflow_dispatch (manual only — no schedule).
 * Auth: x-assessment-key header must match ASSESSMENT_API_KEY env var.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import { reviewSession } from "@/lib/analytics/sessionReview";
import { logServerEvent } from "@/lib/logging";

// Smart model + up to 10 cases per group — allow generous time
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const assessSecret = process.env.ASSESSMENT_API_KEY;
  const givenKey     = req.headers.get("x-assessment-key");

  if (!assessSecret || givenKey !== assessSecret) {
    return apiError(401, "UNAUTHORIZED", "无效的密钥。");
  }

  const admin = getServiceRoleClient();

  try {
    const row = await reviewSession({ client: admin });
    return NextResponse.json({ ok: true, review: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("无已分析病案")) {
      return apiError(400, "NO_CONSULTATIONS", message);
    }

    await logServerEvent({
      source: "api/cron/session-review",
      message: "提示词审查失败。",
      details: { error: message },
    });

    return apiError(500, "INTERNAL_ERROR", "审查生成失败，请稍后重试。");
  }
}
