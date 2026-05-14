import fs from "node:fs/promises";
import path from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";
import { loadAssessmentExamples } from "./lib/assessment/examples.mjs";
import { startAssessmentServer } from "./lib/assessment/server.mjs";
import { runFrontendAssessment } from "./lib/assessment/frontend.mjs";
import { saveAssessmentRun } from "./lib/assessment/db.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

function stampForPath(date = new Date()) {
  return date
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "")
    .replace("T", "_");
}

async function main() {
  const runId = `frontend-${stampForPath()}`;
  const outputDir = path.join(rootDir, "output", "assessment", runId);
  const screenshotDir = path.join(outputDir, "screenshots");

  await fs.mkdir(screenshotDir, { recursive: true });

  const examples = await loadAssessmentExamples(
    path.join(rootDir, "local-data", "real-doctor-examples.md"),
  );
  const doctorEmail = process.env.DEV_AUTH_EMAIL || "chiaweiwoo123@gmail.com";

  const server = await startAssessmentServer({
    rootDir,
    port: 3100,
    outputDir,
    doctorEmail,
  });

  try {
    const { reportData, markdownReport } = await runFrontendAssessment({
      baseUrl: server.baseUrl,
      examples,
      screenshotDir,
      runId,
      exampleCount: 3,
    });

    const markdownPath = path.join(outputDir, "frontend-report.md");
    const jsonPath = path.join(outputDir, "frontend-report.json");

    await fs.writeFile(markdownPath, markdownReport, "utf8");
    await fs.writeFile(jsonPath, JSON.stringify(reportData, null, 2), "utf8");

    // Save to Supabase using the same pattern as backend assessment
    const savedToDb = await saveAssessmentRun({
      results: {
        runId,
        generatedAt: reportData.generatedAt,
        baseUrl: server.baseUrl,
        examples: reportData.selectedExamples.map((e) => ({ id: e.id })),
      },
      aggregate: {
        organizeStats: null,
        modeStats: null,
        blockedReasonGroups: Object.fromEntries(
          reportData.scenarios
            .filter((s) => s.blockedReason)
            .map((s) => [s.blockedReason, 1]),
        ),
      },
      reviewer: {
        text: [
          "## UX 评审\n" + reportData.reviewers.ux.text,
          "## 临床评审\n" + reportData.reviewers.tcm.text,
          "## 视觉评审\n" + reportData.reviewers.visual.text,
        ].join("\n\n---\n\n"),
        model: `ux:${reportData.reviewers.ux.model} tcm:${reportData.reviewers.tcm.model} visual:${reportData.reviewers.visual.model}`,
      },
    });

    console.log(
      JSON.stringify(
        {
          status: "completed",
          runId,
          reusedServer: server.reused,
          baseUrl: server.baseUrl,
          exampleCount: reportData.selectedExamples.length,
          scenarioCount: reportData.scenarios.length,
          aggregate: reportData.aggregate,
          markdownReport: markdownPath,
          jsonReport: jsonPath,
          screenshots: reportData.screenshots.length,
          savedToDb,
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
