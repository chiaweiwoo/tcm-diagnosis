/**
 * assess:seed — populate doctor_examples table from local .md file.
 *
 * Usage:
 *   npm run assess:seed -- --file local-data/real-doctor-examples.md
 *
 * Idempotent: upserts on id, so re-running is safe.
 * After seeding, assess:run no longer needs the local file.
 */

import path from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";
import { parseExamplesFromFile } from "./lib/assessment/examples.mjs";

const rootDir = process.cwd();
loadLocalEnv(rootDir);

function parseArgs() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--file");
  if (flagIdx !== -1 && args[flagIdx + 1]) return args[flagIdx + 1];
  const inlineFlag = args.find((a) => a.startsWith("--file="));
  if (inlineFlag) return inlineFlag.split("=")[1];
  return "local-data/real-doctor-examples.md";
}

async function upsertExamples(examples) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase credentials not set. Check .env.local");
  }

  const rows = examples.map((ex) => ({
    id: ex.id,
    case_type_guess: ex.caseTypeGuess,
    topic_guess: ex.topicGuess,
    draft: ex.draft,
    is_active: true,
    updated_at: new Date().toISOString(),
  }));

  const response = await fetch(`${supabaseUrl}/rest/v1/doctor_examples`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      // upsert: merge on id conflict
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Upsert failed: ${response.status} ${detail.slice(0, 400)}`);
  }
}

async function main() {
  const relFile = parseArgs();
  const filePath = path.resolve(rootDir, relFile);

  console.log(`[assess:seed] reading ${filePath}`);
  const examples = await parseExamplesFromFile(filePath);

  if (examples.length === 0) {
    console.error("[assess:seed] No examples found in file. Check the heading format: ## real-example-NNN | caseType | topic");
    process.exitCode = 1;
    return;
  }

  console.log(`[assess:seed] upserting ${examples.length} examples to DB`);
  await upsertExamples(examples);

  console.log(
    JSON.stringify(
      {
        status: "seeded",
        count: examples.length,
        ids: examples.map((e) => e.id),
      },
      null,
      2,
    ),
  );
  console.log("[assess:seed] Done. assess:run will now read from DB.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
