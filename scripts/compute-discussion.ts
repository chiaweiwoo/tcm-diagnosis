/**
 * scripts/compute-discussion.ts
 *
 * CLI runner for pre-computing the discussion agenda for a specific doctor (or all active doctors).
 * Usage:
 *   npx tsx scripts/compute-discussion.ts --email ardytcm@gmail.com
 *   npx tsx scripts/compute-discussion.ts --doctorId <uuid>
 *   npx tsx scripts/compute-discussion.ts --email ardytcm@gmail.com --force
 *
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + DEEPSEEK_API_KEY
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/compute-discussion.ts --email ...
 *      OR: npm run discussion -- --email ...
 */

import { createClient } from "@supabase/supabase-js";
import {
  computeDiscussionForDoctor,
  computeDiscussionsForActiveDoctors,
  getLatestAnalyzedAt,
} from "../src/lib/nudge/computeDiscussion";

// ─── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag: string): string | null {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const email = getArg("--email");
const doctorId = getArg("--doctorId");
const force = args.includes("--force");

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Resolve doctor UUID from email ──────────────────────────────────────────

async function resolveUuidByEmail(targetEmail: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Failed to list users: ${error.message}`);

  const user = data.users.find(
    (u) => u.email?.toLowerCase().trim() === targetEmail.toLowerCase().trim(),
  );
  if (!user) throw new Error(`No auth user found with email: ${targetEmail}`);
  return user.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Doctor Discussion Agenda CLI ===\n");

  if (!email && !doctorId) {
    // No target — run fleet-wide
    console.log("No --email or --doctorId specified. Running fleet-wide...\n");
    const result = await computeDiscussionsForActiveDoctors(admin);
    console.log(`✓ Computed: ${result.computed.length} doctor(s)`);
    if (result.computed.length) console.log("  ", result.computed.join(", "));
    console.log(`  Skipped: ${result.skipped.length} doctor(s)`);
    if (result.skipped.length) console.log("  ", result.skipped.join(", "));
    return;
  }

  // Single-doctor mode
  let targetId: string;
  let targetLabel: string;

  if (doctorId) {
    targetId = doctorId;
    targetLabel = doctorId;
  } else {
    console.log(`Resolving UUID for ${email}...`);
    targetId = await resolveUuidByEmail(email!);
    targetLabel = `${email} (${targetId})`;
  }

  console.log(`Target: ${targetLabel}`);
  if (force) console.log("  --force: bypassing watermark\n");

  // Show latest analyzed_at
  const latest = await getLatestAnalyzedAt(admin, targetId);
  console.log(`Latest analyzed_at: ${latest?.toISOString() ?? "(none)"}`);

  const t0 = Date.now();
  const result = await computeDiscussionForDoctor(admin, targetId, { force });
  const elapsed = Date.now() - t0;

  console.log(`\nResult:`);
  console.log(`  status:     ${result.status}`);
  if (result.itemCount !== undefined) console.log(`  items:      ${result.itemCount}`);
  console.log(`  elapsed:    ${elapsed}ms`);

  if (result.status === "computed") {
    console.log(`\n✓ Discussion row upserted for ${targetLabel}.`);
    console.log("  Verify: SELECT doctor_id, jsonb_array_length(items), computed_at, source_last_record_at FROM doctor_discussion_agenda;");
  } else if (result.status === "skipped") {
    console.log(`\n  → Skipped (watermark unchanged — no new analyzed cases since last run).`);
    console.log("  Run with --force to bypass.\n");
  } else {
    console.log(`\n  → ${result.status}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
