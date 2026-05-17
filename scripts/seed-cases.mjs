#!/usr/bin/env node
/**
 * scripts/seed-cases.mjs
 *
 * Seed real consultation cases for a doctor from data/seed-cases.json.
 * Each case is analyzed via /api/analyze then saved to the consultations table.
 *
 * Usage:
 *   node scripts/seed-cases.mjs --email doctor@example.com [--reset] [--yes]
 *
 * --reset: deletes the doctor's existing consultations first (prompts unless --yes)
 *
 * Requires in env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ASSESSMENT_API_KEY          (used as X-Assessment-Key header for /api/analyze)
 *   APP_BASE_URL                (e.g. http://localhost:3000 or production URL)
 *
 * Load via: node --env-file=.env.local scripts/seed-cases.mjs ...
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    email:  { type: "string" },
    reset:  { type: "boolean", default: false },
    yes:    { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.email) {
  console.error("Error: --email is required");
  process.exit(1);
}

const email = values.email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const assessKey    = process.env.ASSESSMENT_API_KEY;
const baseUrl      = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!supabaseUrl || !serviceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
if (!assessKey) {
  console.error("Error: ASSESSMENT_API_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Resolve doctor UUID
// ---------------------------------------------------------------------------

const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listError) {
  console.error("Error listing auth.users:", listError.message);
  process.exit(1);
}

const doctorUser = usersData.users.find((u) => u.email?.toLowerCase() === email);
if (!doctorUser) {
  console.error(`Error: no auth.users row for ${email}.`);
  console.error("Tip: run 'node scripts/allowlist-add.mjs --email <email>' first.");
  process.exit(1);
}

const doctorId = doctorUser.id;
console.log(`Doctor: ${email} (${doctorId})`);

// ---------------------------------------------------------------------------
// Optional reset
// ---------------------------------------------------------------------------

if (values.reset) {
  let confirmed = values.yes;
  if (!confirmed) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    confirmed = await new Promise((resolve) => {
      rl.question(`Delete all existing consultations for ${email}? (y/N) `, (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase() === "y");
      });
    });
  }
  if (!confirmed) {
    console.log("Aborted.");
    process.exit(0);
  }

  const { error: delError } = await supabase
    .from("consultations")
    .delete()
    .eq("doctor_id", doctorId);

  if (delError) {
    console.error("Error deleting consultations:", delError.message);
    process.exit(1);
  }
  console.log(`✓ Deleted existing consultations for ${email}`);
}

// ---------------------------------------------------------------------------
// Load seed cases
// ---------------------------------------------------------------------------

let seedCases;
try {
  const raw = readFileSync("data/seed-cases.json", "utf8");
  seedCases = JSON.parse(raw);
} catch {
  console.error("Error: could not read data/seed-cases.json");
  console.error("Make sure the file exists (it is gitignored — never commit it).");
  process.exit(1);
}

console.log(`\nSeeding ${seedCases.length} cases for ${email}…\n`);

// ---------------------------------------------------------------------------
// Process all cases in parallel
// ---------------------------------------------------------------------------

async function seedOne(form_data, index) {
  const label = `[${index + 1}/${seedCases.length}] ${form_data.chiefComplaint ?? "(no complaint)"}`;

  // 1. Analyze via /api/analyze (server-side, bypasses browser auth)
  let analysisResult, analysisRaw, modelMeta;
  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Assessment-Key": assessKey,
    },
    body: JSON.stringify({ form: form_data }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${label} — analyze failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  analysisResult = data.result;
  analysisRaw    = data.raw;
  modelMeta      = {
    model:         data.model,
    promptVersion: data.promptVersion,
    repairedJson:  data.repairedJson ?? false,
  };

  // 2. Insert consultation row via service-role (bypasses RLS)
  const { error: insertError } = await supabase.from("consultations").insert({
    doctor_id:        doctorId,
    doctor_email:     email,
    form_data:        form_data,
    analysis_result:  analysisResult,
    analysis_raw:     analysisRaw,
    model_meta:       modelMeta,
    analysis_status:  "analyzed",
    analyzed_at:      new Date().toISOString(),
  });
  if (insertError) throw new Error(`${label} — insert failed: ${insertError.message}`);

  return label;
}

const results = await Promise.allSettled(
  seedCases.map(({ form_data }, i) => seedOne(form_data, i)),
);

let passed = 0;
let failed = 0;
for (const r of results) {
  if (r.status === "fulfilled") {
    console.log(`  ✓ ${r.value}`);
    passed++;
  } else {
    console.error(`  ✗ ${r.reason?.message ?? r.reason}`);
    failed++;
  }
}

console.log(`\nDone: ${passed} seeded, ${failed} failed.`);
if (failed > 0) process.exit(1);
