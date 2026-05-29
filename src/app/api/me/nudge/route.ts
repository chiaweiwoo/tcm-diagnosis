/**
 * GET /api/me/nudge
 *
 * Returns the doctor's risk-nudge card (AI 反复提醒的风险点).
 * Supports admin X-View-As preview (same pattern as /api/me/profile).
 *
 * Raw counts are NEVER sent to the client — only weights (0–1) and examples.
 * Cache: private, 5 min (nudge updates at most once per daily cron run).
 */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiResponses";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getViewAsContext, ViewAsError } from "@/lib/viewAs";

type DbNudgeRow = {
  themes: Array<{ key: string; count: number; examples: string[]; originalKey?: string; description?: string }>;
  computed_at: string | null;
};

export async function GET(request: Request) {
  try {
    const viewAs = await getViewAsContext(request);
    const admin = getServiceRoleClient();

    const { data, error } = await admin
      .from("doctor_risk_nudges")
      .select("themes, computed_at")
      .eq("doctor_id", viewAs.effectiveDoctor.id)
      .maybeSingle();

    if (error) {
      return apiError(500, "INTERNAL_ERROR", "读取风险提示失败。");
    }

    const cacheHeaders = {
      "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
    };

    if (!data || !Array.isArray((data as DbNudgeRow).themes)) {
      return NextResponse.json({ themes: [], computedAt: null }, { headers: cacheHeaders });
    }

    const row = data as DbNudgeRow;
    const rawThemes = row.themes;

    if (!rawThemes.length) {
      return NextResponse.json(
        { themes: [], computedAt: row.computed_at },
        { headers: cacheHeaders },
      );
    }

    // Convert counts → weights server-side. Raw counts never leave the server.
    const max = Math.max(...rawThemes.map((t) => t.count), 1);
    const themes = rawThemes.map((t) => ({
      key: t.key,
      weight: t.count / max, // 0–1
      description: t.description || null,
      examples: (t.examples ?? []).slice(0, 5),
      originalKey: t.originalKey || null,
    }));

    return NextResponse.json(
      { themes, computedAt: row.computed_at },
      { headers: cacheHeaders },
    );
  } catch (error) {
    if (error instanceof ViewAsError) {
      return apiError(error.status, error.code, error.message);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return apiError(401, "UNAUTHORIZED", "请先登录。");
    }
    return apiError(500, "INTERNAL_ERROR", "读取风险提示失败。");
  }
}
