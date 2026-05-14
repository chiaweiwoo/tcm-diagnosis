import { loadLocalEnv } from "./lib/env.mjs";
import { fetchRawRun, updateReviewerOutput } from "./lib/assessment/db.mjs";
import { reviewBackendAssessment } from "./lib/assessment/reviewers.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

async function main() {
  const runId = process.argv[2] || process.env.RUN_ID;
  if (!runId) throw new Error("Usage: node scripts/assess-review.mjs <run_id>\n  or set RUN_ID env var");

  console.log(`[assess:review] fetching run_id=${runId}`);

  const row = await fetchRawRun(runId);
  if (!row) throw new Error(`Run not found in DB: ${runId}`);

  // The aggregate is stored inside raw_results; fall back to top-level stats if needed
  const aggregate = row.raw_results?.aggregate ?? {
    runId: row.run_id,
    exampleCount: row.example_count,
    organizeStats: row.organize_stats,
    modeStats: row.mode_stats,
    blockedReasonGroups: row.blocked_reason_groups,
    examples: [],
  };

  console.log(`[assess:review] running reviewer  examples=${aggregate.exampleCount}`);

  const reviewer = await reviewBackendAssessment(aggregate);

  const saved = await updateReviewerOutput({ runId, reviewer });

  console.log(
    JSON.stringify(
      {
        status: "reviewed",
        runId,
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
