import path from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";
import { loadAssessmentExamples } from "./lib/assessment/examples.mjs";
import { runBackendAssessment } from "./lib/assessment/backend.mjs";
import { saveRawRun } from "./lib/assessment/db.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

function sgtRunId() {
  // SGT = UTC+8
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const datePart = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
  return `assessment-${datePart}_${timePart}-SGT`;
}

async function main() {
  const baseUrl = process.env.ASSESS_BASE_URL;
  if (!baseUrl) throw new Error("ASSESS_BASE_URL must be set in .env.local (e.g. https://your-vercel-app.vercel.app)");

  const examples = await loadAssessmentExamples(path.join(rootDir, "local-data", "real-doctor-examples.md"));
  const runId = sgtRunId();

  console.log(`[assess:run] run_id=${runId}  examples=${examples.length}  base=${baseUrl}`);

  const report = await runBackendAssessment({ baseUrl, examples, runId });

  const saved = await saveRawRun({
    runId,
    results: report.results,
    aggregate: report.aggregate,
    baseUrl,
  });

  console.log(
    JSON.stringify(
      {
        status: "raw",
        runId,
        exampleCount: examples.length,
        organizeSuccess: report.aggregate.organizeStats.success,
        smartSuccess: report.aggregate.modeStats.smart.success,
        normalSuccess: report.aggregate.modeStats.normal.success,
        savedToDb: saved,
        nextStep: `node scripts/assess-review.mjs ${runId}`,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
