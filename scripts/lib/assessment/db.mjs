const SUPABASE_TABLE = "assessment_runs";

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return { supabaseUrl, serviceKey };
}

export async function saveAssessmentRun({ results, aggregate, reviewer }) {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn("[db] Supabase credentials not set — assessment run not saved to database.");
    return false;
  }

  const row = {
    run_id: results.runId,
    triggered_by: "cli",
    created_at: results.generatedAt,
    example_count: results.examples.length,
    base_url: results.baseUrl,
    organize_stats: aggregate.organizeStats ?? null,
    mode_stats: aggregate.modeStats ?? null,
    blocked_reason_groups: aggregate.blockedReasonGroups ?? null,
    reviewer_text: reviewer.text ?? null,
    reviewer_model: reviewer.model ?? null,
    full_report: { results, aggregate, reviewer },
    status: "completed",
  };

  try {
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/${SUPABASE_TABLE}`,
      {
        method: "POST",
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error(`[db] Failed to save assessment run: ${response.status} ${detail.slice(0, 300)}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[db] Error saving assessment run:", error instanceof Error ? error.message : String(error));
    return false;
  }
}
