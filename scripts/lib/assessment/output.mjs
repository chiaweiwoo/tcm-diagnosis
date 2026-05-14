import fs from "node:fs/promises";
import path from "node:path";

function stampForPath(date = new Date()) {
  return date
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "")
    .replace("T", "_");
}

export async function createAssessmentOutput(rootDir) {
  const runId = `assessment-${stampForPath()}`;
  const outputDir = path.join(rootDir, "output", "assessment", runId);
  const screenshotDir = path.join(outputDir, "screenshots");

  await fs.mkdir(screenshotDir, { recursive: true });

  return {
    runId,
    outputDir,
    screenshotDir,
    markdownPath: path.join(outputDir, "report.md"),
    jsonPath: path.join(outputDir, "report.json"),
  };
}
