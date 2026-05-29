/**
 * Cron route: POST /api/cron/dr_discussion
 *
 * Triggers the fleet-wide doctor discussion-agenda pre-computation.
 * Auth: X-Assessment-Key header must match ASSESSMENT_API_KEY env var.
 * Schedule: weekly SGT Sunday 03:00 (19:00 UTC) via .github/workflows/dr_discussion.yml
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";
import { computeDiscussionsForActiveDoctors } from "@/lib/nudge/computeDiscussion";
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
    const result = await computeDiscussionsForActiveDoctors(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await logServerEvent({
      source: "api/cron/dr_discussion",
      message: "讨论清单计算失败。",
      details: { error: message },
    });

    return apiError(500, "INTERNAL_ERROR", "讨论清单计算失败，请稍后重试。");
  }
}
