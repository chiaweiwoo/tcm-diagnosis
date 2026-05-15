const SUPABASE_TABLE = "assessment_runs";

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return { supabaseUrl, serviceKey };
}

function warnNoCredentials(caller) {
  console.warn(`[db:${caller}] Supabase credentials not set — skipped.`);
}

async function supabasePost(config, path, body) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${detail.slice(0, 300)}`);
  }
}

async function supabasePatch(config, path, body) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${detail.slice(0, 300)}`);
  }
}

async function supabaseGet(config, path) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${detail.slice(0, 300)}`);
  }
  return response.json();
}

// assess:run — save raw results immediately after API calls, before reviewer
export async function saveRawRun({ runId, mode, results, aggregate, baseUrl }) {
  const config = getSupabaseConfig();
  if (!config) { warnNoCredentials("saveRawRun"); return false; }

  const row = {
    run_id: runId,
    mode: mode ?? null,
    triggered_by: "assess:run",
    created_at: results.generatedAt,
    example_count: results.examples.length,
    base_url: baseUrl,
    organize_stats: aggregate.organizeStats ?? null,
    mode_stats: aggregate.modeStats ?? null,
    blocked_reason_groups: aggregate.blockedReasonGroups ?? null,
    raw_results: { results, aggregate },
    status: "raw",
  };

  try {
    await supabasePost(config, SUPABASE_TABLE, row);
    return true;
  } catch (err) {
    console.error(`[db:saveRawRun] ${err.message}`);
    return false;
  }
}

// assess:review — fetch the raw run so the reviewer can read pipeline data
export async function fetchRawRun(runId) {
  const config = getSupabaseConfig();
  if (!config) { warnNoCredentials("fetchRawRun"); return null; }

  try {
    const rows = await supabaseGet(
      config,
      `${SUPABASE_TABLE}?run_id=eq.${encodeURIComponent(runId)}&select=run_id,mode,raw_results,organize_stats,mode_stats,blocked_reason_groups,example_count,base_url,created_at`,
    );
    if (!rows || rows.length === 0) throw new Error(`run_id not found: ${runId}`);
    return rows[0];
  } catch (err) {
    console.error(`[db:fetchRawRun] ${err.message}`);
    return null;
  }
}

// assess:review — write all reviewer output and mark the run as reviewed
export async function updateReviewerOutput({ runId, reviewer, exampleReviews, sectionReviews }) {
  const config = getSupabaseConfig();
  if (!config) { warnNoCredentials("updateReviewerOutput"); return false; }

  try {
    await supabasePatch(
      config,
      `${SUPABASE_TABLE}?run_id=eq.${encodeURIComponent(runId)}`,
      {
        reviewer_text: reviewer.text ?? null,
        reviewer_model: reviewer.model ?? null,
        example_reviews: exampleReviews ?? null,
        section_reviews: sectionReviews ?? null,
        status: "reviewed",
      },
    );
    return true;
  } catch (err) {
    console.error(`[db:updateReviewerOutput] ${err.message}`);
    return false;
  }
}
