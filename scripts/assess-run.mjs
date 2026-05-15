import path from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";
import { loadAssessmentExamples } from "./lib/assessment/examples.mjs";
import { runBackendAssessment } from "./lib/assessment/backend.mjs";
import { saveRawRun } from "./lib/assessment/db.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

function parseMode() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--mode");
  if (flagIdx !== -1 && args[flagIdx + 1]) return args[flagIdx + 1];
  const inlineFlag = args.find((a) => a.startsWith("--mode="));
  if (inlineFlag) return inlineFlag.split("=")[1];
  return "normal";
}

function sgtRunId(mode) {
  // SGT = UTC+8
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const datePart = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
  return `assessment-${datePart}_${timePart}-SGT-${mode}`;
}

async function main() {
  const mode = parseMode();
  if (!["normal", "smart"].includes(mode)) {
    throw new Error(`Invalid mode "${mode}". Use --mode normal or --mode smart.`);
  }

  const baseUrl = process.env.ASSESS_BASE_URL;
  if (!baseUrl) throw new Error("ASSESS_BASE_URL must be set in .env.local (e.g. https://your-vercel-app.vercel.app)");

  const examples = await loadAssessmentExamples(path.join(rootDir, "local-data", "real-doctor-examples.md"));
  const runId = sgtRunId(mode);

  console.log(`[assess:run] run_id=${runId}  mode=${mode}  examples=${examples.length}  base=${baseUrl}`);

  const report = await runBackendAssessment({ baseUrl, examples, runId, mode });
  const stats = report.aggregate.modeStats?.[mode] ?? {};

  const saved = await saveRawRun({
    runId,
    mode,
    results: report.results,
    aggregate: report.aggregate,
    baseUrl,
  });

  console.log(
    JSON.stringify(
      {
        status: "raw",
        runId,
        mode,
        exampleCount: examples.length,
        organizeSuccess: report.aggregate.organizeStats.success,
        analyzeSuccess: stats.success ?? 0,
        analyzeBlocked: stats.blocked ?? 0,
        analyzeFailed: stats.failed ?? 0,
        savedToDb: saved,
        nextStep: `RUN_ID=${runId} — trigger GitHub Actions "Assess Review" with this run_id`,
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
