/**
 * Cron route: POST /api/cron/risk-nudge
 *
 * Triggers the fleet-wide doctor risk-nudge computation.
 * Auth: X-Assessment-Key header must match ASSESSMENT_API_KEY env var.
 * Schedule: daily at 03:00 SGT (19:00 UTC) via .github/workflows/risk-nudge.yml
 *           This is the first scheduled (non-dispatch-only) workflow in this project.
 *
 * Mirror of /api/cron/output-audit pattern.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import { computeNudgesForActiveDoctors } from "@/lib/nudge/computeNudge";
import { logServerEvent } from "@/lib/logging";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const assessSecret = process.env.ASSESSMENT_API_KEY;
  const givenKey = req.headers.get("x-assessment-key");

  if (!assessSecret || givenKey !== assessSecret) {
    return apiError(401, "UNAUTHORIZED", "无效的密钥。");
  }

  const admin = getServiceRoleClient();

  try {
    const result = await computeNudgesForActiveDoctors(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await logServerEvent({
      source: "api/cron/risk-nudge",
      message: "风险提示计算失败。",
      details: { error: message },
    });

    return apiError(500, "INTERNAL_ERROR", "风险提示计算失败，请稍后重试。");
  }
}
