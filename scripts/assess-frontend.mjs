import fs from "node:fs/promises";
import path from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";
import { loadAssessmentExamples } from "./lib/assessment/examples.mjs";
import { startAssessmentServer } from "./lib/assessment/server.mjs";
import { runFrontendAssessment } from "./lib/assessment/frontend.mjs";
import { uploadScreenshots } from "./lib/assessment/storage.mjs";
import { saveAssessmentRun } from "./lib/assessment/db.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

function stampForPath(date = new Date()) {
  return date.toISOString().replace(/:/g, "-").replace(/\..+$/, "").replace("T", "_");
}

async function main() {
  const runId = `frontend-${stampForPath()}`;
  const outputDir = path.join(rootDir, "output", "assessment", runId);
  const screenshotDir = path.join(outputDir, "screenshots");

  await fs.mkdir(screenshotDir, { recursive: true });

  const examples = await loadAssessmentExamples(
    path.join(rootDir, "local-data", "real-doctor-examples.md"),
  );
  const doctorEmail = process.env.DEV_AUTH_EMAIL;
  if (!doctorEmail) throw new Error("DEV_AUTH_EMAIL must be set in .env.local to run assessments");

  const server = await startAssessmentServer({
    rootDir,
    port: 3100,
    outputDir,
    doctorEmail,
  });

  try {
    // Step 1: browser automation only
    const runData = await runFrontendAssessment({
      baseUrl: server.baseUrl,
      examples,
      screenshotDir,
      runId,
      exampleCount: 3,
    });

    // Upload screenshots to Supabase Storage
    console.error("[frontend] Uploading screenshots...");
    const screenshotUrls = await uploadScreenshots(runId, runData.screenshots);

    // Save run record to DB (full_report includes scenarios + screenshotUrls for step 2)
    const savedToDb = await saveAssessmentRun({
      results: {
        runId,
        generatedAt: runData.generatedAt,
        baseUrl: server.baseUrl,
        examples: runData.selectedExamples.map((e) => ({ id: e.id })),
      },
      aggregate: {
        organizeStats: null,
        modeStats: null,
        blockedReasonGroups: Object.fromEntries(
          runData.scenarios
            .filter((s) => s.blockedReason)
            .map((s) => [s.blockedReason, 1]),
        ),
      },
      reviewer: {
        // No reviewer yet — report generation is step 2
        text: null,
        model: null,
      },
      extra: {
        triggered_by: "assess:frontend",
        full_report: {
          ...runData,
          screenshotUrls,
          screenshots: undefined, // don't store local paths in DB
        },
      },
    });

    console.log(
      JSON.stringify(
        {
          status: "run-complete",
          runId,
          reusedServer: server.reused,
          baseUrl: server.baseUrl,
          exampleCount: runData.selectedExamples.length,
          scenarioCount: runData.scenarios.length,
          aggregate: runData.aggregate,
          screenshotsUploaded: Object.values(screenshotUrls).filter(Boolean).length,
          savedToDb,
          next: `npm run report:frontend -- ${runId}`,
        },
        null,
        2,
      ),
    );
  } finally {
    await server.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
