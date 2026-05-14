export type AssessmentRunSummary = {
  run_id: string;
  triggered_by: string;
  created_at: string;
  example_count: number | null;
  status: string;
  organize_stats: { success: number; failed: number; total: number } | null;
  mode_stats: Record<string, {
    count: number;
    success: number;
    blocked: number;
    failed: number;
    repairTriggered: number;
    averageLatencyMs: number;
    averageCostUsd: number;
  }> | null;
};

export type AssessmentRunDetail = AssessmentRunSummary & {
  base_url: string | null;
  blocked_reason_groups: Record<string, number> | null;
  reviewer_text: string | null;
  reviewer_model: string | null;
  report_url: string | null;
  full_report: unknown | null;
};

function getConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return {
    baseUrl: `${supabaseUrl}/rest/v1/assessment_runs`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  };
}

export async function listAssessmentRuns(): Promise<AssessmentRunSummary[]> {
  const config = getConfig();
  if (!config) return [];

  const url = new URL(config.baseUrl);
  url.searchParams.set(
    "select",
    "run_id,triggered_by,created_at,example_count,status,organize_stats,mode_stats",
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "50");

  const response = await fetch(url, { headers: config.headers, cache: "no-store" });
  if (!response.ok) return [];
  return (await response.json()) as AssessmentRunSummary[];
}

export async function getAssessmentRun(runId: string): Promise<AssessmentRunDetail | null> {
  const config = getConfig();
  if (!config) return null;

  const url = new URL(config.baseUrl);
  url.searchParams.set("run_id", `eq.${runId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { headers: config.headers, cache: "no-store" });
  if (!response.ok) return null;
  const rows = (await response.json()) as AssessmentRunDetail[];
  return rows[0] ?? null;
}
