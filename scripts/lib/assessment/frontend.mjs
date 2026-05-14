import { runBrowserScenarios } from "./browser.mjs";

function pickRandomExamples(examples, count) {
  const eligible = examples.filter((e) => e.draft && e.draft.trim().length > 100);
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export async function cleanupRecords(baseUrl, scenarios) {
  const recordIds = scenarios.map((s) => s.recordId).filter(Boolean);
  const cleaned = [];
  const failed = [];

  for (const id of recordIds) {
    try {
      const res = await fetch(`${baseUrl}/api/consultations/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        cleaned.push(id);
      } else {
        failed.push({ id, status: res.status });
      }
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { attempted: recordIds.length, succeeded: cleaned.length, failed };
}

export function buildAggregate(scenarios) {
  return {
    total: scenarios.length,
    success: scenarios.filter((s) => s.status === "success").length,
    blocked: scenarios.filter((s) => s.blockedState).length,
    failed: scenarios.filter((s) => s.status === "failed").length,
    warnings: scenarios.flatMap((s) => s.warnings ?? []),
  };
}

// Step 1: run browser automation only. No reviewers, no HTML.
// Returns the run data to be saved to DB and uploaded to storage.
export async function runFrontendAssessment({ baseUrl, examples, screenshotDir, runId, exampleCount = 3 }) {
  const generatedAt = new Date().toISOString();
  const selectedExamples = pickRandomExamples(examples, exampleCount);

  if (selectedExamples.length === 0) {
    throw new Error("No eligible examples found (need drafts > 100 chars). Check local-data/real-doctor-examples.md");
  }

  console.error(`[frontend] Selected examples: ${selectedExamples.map((e) => e.id).join(", ")}`);

  const { scenarios, screenshots } = await runBrowserScenarios({
    baseUrl,
    examples: selectedExamples,
    screenshotDir,
    runId,
  });

  const cleanup = await cleanupRecords(baseUrl, scenarios);
  const aggregate = buildAggregate(scenarios);

  return {
    runId,
    generatedAt,
    baseUrl,
    selectedExamples: selectedExamples.map((e) => ({ id: e.id, caseTypeGuess: e.caseTypeGuess })),
    scenarios,
    aggregate,
    cleanup,
    screenshots, // local file paths — caller uploads these
  };
}
