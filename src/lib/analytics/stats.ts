/**
 * Analytics utilities.
 *
 * buildWindow — shared analytics date-window helper.
 * buildWindowFromLatestAnalysis — anchors window to the most recent analyzed_at
 *   across the entire fleet. Used by the output audit so the window always covers
 *   real activity even if no one has analyzed today.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export function buildWindow(days: number): { windowStart: Date; windowEnd: Date } {
  // windowEnd = start of tomorrow so today's records are always included in the window
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 1);
  windowEnd.setHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - days);
  return { windowStart, windowEnd };
}

/**
 * Anchor the audit window to the fleet's most recent analyzed_at timestamp.
 * windowEnd = latestAnalyzedAt + 1ms (exclusive upper bound, same day included)
 * windowStart = windowEnd - days
 *
 * Fallback: if no analyzed records exist, falls back to buildWindow(days).
 */
export async function buildWindowFromLatestAnalysis(
  client: SupabaseClient,
  days = 14,
): Promise<{ windowStart: Date; windowEnd: Date }> {
  const { data } = await client
    .from("consultations")
    .select("analyzed_at")
    .not("analyzed_at", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.analyzed_at) {
    return buildWindow(days);
  }

  const latest = new Date(data.analyzed_at as string);
  // windowEnd = day after latest so the latest record is always inside the window
  const windowEnd = new Date(latest);
  windowEnd.setDate(windowEnd.getDate() + 1);
  windowEnd.setHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - days);
  return { windowStart, windowEnd };
}
