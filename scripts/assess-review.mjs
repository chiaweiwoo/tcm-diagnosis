import { loadLocalEnv } from "./lib/env.mjs";
import { fetchRawRun, updateReviewerOutput } from "./lib/assessment/db.mjs";
import { reviewAllExamples } from "./lib/assessment/perExampleReviewer.mjs";
import { reviewAllSections } from "./lib/assessment/perSectionReviewer.mjs";
import { reviewBackendAssessment } from "./lib/assessment/reviewers.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

async function main() {
  const runId = process.argv[2] || process.env.RUN_ID;
  if (!runId) throw new Error("Usage: node scripts/assess-review.mjs <run_id>\n  or set RUN_ID env var");

  console.log(`[assess:review] fetching run_id=${runId}`);

  const row = await fetchRawRun(runId);
  if (!row) throw new Error(`Run not found in DB: ${runId}`);

  const mode = row.mode ?? "normal";
  // Use full results (not trimmed aggregate) for deep review
  const fullExamples = row.raw_results?.results?.examples ?? [];
  const aggregate = row.raw_results?.aggregate ?? {
    runId: row.run_id,
    mode,
    exampleCount: row.example_count,
    organizeStats: row.organize_stats,
    modeStats: row.mode_stats,
    blockedReasonGroups: row.blocked_reason_groups,
    examples: [],
  };

  console.log(`[assess:review] mode=${mode}  examples=${fullExamples.length}`);
  console.log("[assess:review] stage 1+2: per-example scorecards + per-section consistency (parallel)");

  // Stage 1 + 2 in parallel — independent of each other
  const [exampleReviews, sectionReviews] = await Promise.all([
    reviewAllExamples(fullExamples, mode),
    reviewAllSections(fullExamples, mode),
  ]);

  console.log(`[assess:review] stage 1 done: ${exampleReviews.length} example scorecards`);
  console.log(`[assess:review] stage 2 done: ${sectionReviews.length} section analyses`);
  console.log("[assess:review] stage 3: final synthesis");

  const reviewer = await reviewBackendAssessment(aggregate, exampleReviews, sectionReviews);

  console.log("[assess:review] saving to DB");
  const saved = await updateReviewerOutput({ runId, reviewer, exampleReviews, sectionReviews });

  console.log(
    JSON.stringify(
      {
        status: "reviewed",
        runId,
        mode,
        exampleReviewCount: exampleReviews.length,
        sectionReviewCount: sectionReviews.length,
        reviewerModel: reviewer.model,
        usage: reviewer.usage,
        savedToDb: saved,
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
