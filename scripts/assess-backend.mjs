import path from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";
import { loadAssessmentExamples } from "./lib/assessment/examples.mjs";
import { createAssessmentOutput } from "./lib/assessment/output.mjs";
import { startAssessmentServer } from "./lib/assessment/server.mjs";
import { runBackendAssessment } from "./lib/assessment/backend.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

async function main() {
  const output = await createAssessmentOutput(rootDir);
  const examples = await loadAssessmentExamples(path.join(rootDir, "local-data", "real-doctor-examples.md"));
  const doctorEmail = process.env.DEV_AUTH_EMAIL || "chiaweiwoo123@gmail.com";

  const server = await startAssessmentServer({
    rootDir,
    port: 3100,
    outputDir: output.outputDir,
    doctorEmail,
  });

  try {
    const report = await runBackendAssessment({
      baseUrl: server.baseUrl,
      examples,
      output,
      runId: output.runId,
    });

    console.log(
      JSON.stringify(
        {
          status: "completed",
          runId: output.runId,
          reusedServer: server.reused,
          baseUrl: server.baseUrl,
          exampleCount: examples.length,
          markdownReport: path.join(output.outputDir, "backend-report.md"),
          jsonReport: path.join(output.outputDir, "backend-report.json"),
          reviewerModel: report.reviewer.model,
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
