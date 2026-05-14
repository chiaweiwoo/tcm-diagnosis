import { loadLocalEnv } from "./lib/env.mjs";
import { reviewFrontendUX, reviewFrontendTCM, reviewFrontendVisual } from "./lib/assessment/frontendReviewers.mjs";
import { buildHtmlReport } from "./lib/assessment/htmlReport.mjs";
import { uploadHtmlReport, saveReportUrl } from "./lib/assessment/storage.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase credentials missing in .env.local");
  return { supabaseUrl, serviceKey };
}

async function fetchRun(runId) {
  const { supabaseUrl, serviceKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/assessment_runs`);
  url.searchParams.set("run_id", `eq.${runId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch run: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Run not found: ${runId}`);
  return rows[0];
}

async function patchReviewers(runId, reviewers) {
  const { supabaseUrl, serviceKey } = getSupabaseConfig();
  const url = `${supabaseUrl}/rest/v1/assessment_runs?run_id=eq.${encodeURIComponent(runId)}`;

  const combinedText = [
    "## UX 评审\n" + reviewers.ux.text,
    "## 临床评审\n" + reviewers.tcm.text,
    "## 视觉评审\n" + reviewers.visual.text,
  ].join("\n\n---\n\n");

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      reviewer_text: combinedText,
      reviewer_model: `ux:${reviewers.ux.model} tcm:${reviewers.tcm.model} visual:${reviewers.visual.model}`,
    }),
  });

  if (!res.ok) throw new Error(`Failed to patch reviewers: ${res.status}`);
}

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: npm run report:frontend -- <run-id>");
    process.exitCode = 1;
    return;
  }

  console.error(`[report] Loading run ${runId}...`);
  const row = await fetchRun(runId);
  const runData = row.full_report;

  if (!runData?.scenarios) {
    throw new Error(`Run ${runId} has no scenario data. Was it created by assess:frontend?`);
  }

  const screenshotUrls = runData.screenshotUrls ?? {};
  const observations = { runId, generatedAt: row.created_at, baseUrl: row.base_url, scenarios: runData.scenarios };

  // Collect screenshot URLs for Claude visual reviewer (up to 6)
  const imageUrls = Object.values(screenshotUrls).filter(Boolean).slice(0, 6);

  console.error("[report] Running reviewers...");

  const [uxResult, tcmResult, visualResult] = await Promise.allSettled([
    reviewFrontendUX(observations),
    reviewFrontendTCM(observations),
    reviewFrontendVisual(imageUrls),
  ]);

  const reviewers = {
    ux: uxResult.status === "fulfilled" ? uxResult.value : { model: "error", text: `UX review failed: ${uxResult.reason}`, usage: null },
    tcm: tcmResult.status === "fulfilled" ? tcmResult.value : { model: "error", text: `TCM review failed: ${tcmResult.reason}`, usage: null },
    visual: visualResult.status === "fulfilled" ? visualResult.value : { model: "error", text: `Visual review failed: ${visualResult.reason}`, usage: null, skipped: false },
  };

  const reportData = {
    runId,
    generatedAt: row.created_at,
    baseUrl: row.base_url,
    selectedExamples: runData.selectedExamples ?? [],
    scenarios: runData.scenarios,
    aggregate: runData.aggregate,
    cleanup: runData.cleanup,
    reviewers,
  };

  console.error("[report] Generating and uploading HTML...");
  const html = buildHtmlReport(reportData, screenshotUrls);
  const reportUrl = await uploadHtmlReport(runId, html);

  await patchReviewers(runId, reviewers);
  await saveReportUrl(runId, reportUrl);

  console.log(
    JSON.stringify(
      {
        status: "report-complete",
        runId,
        reportUrl,
        reviewers: {
          ux: reviewers.ux.model,
          tcm: reviewers.tcm.model,
          visual: reviewers.visual.model,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
