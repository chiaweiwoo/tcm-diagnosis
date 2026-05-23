/**
 * consistency_check.mjs
 *
 * Picks one recent analyzed consultation, runs it through /api/analyze
 * N times, and prints a structured consistency report.
 *
 * Usage:
 *   node scratch/consistency_check.mjs
 *   node scratch/consistency_check.mjs --runs 3
 *   node scratch/consistency_check.mjs --email doctor@example.com
 *   BASE_URL=https://your-app.vercel.app node scratch/consistency_check.mjs
 *
 * Prerequisites:
 *   - npm run dev running in another terminal (or BASE_URL set to production)
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *     ASSESSMENT_API_KEY
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    const out = {};
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const get = (k) => env[k] || process.env[k] || "";

const SUPABASE_URL  = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY   = get("SUPABASE_SERVICE_ROLE_KEY");
const ASSESS_KEY    = get("ASSESSMENT_API_KEY");
const BASE_URL      = process.env.BASE_URL || get("ASSESS_BASE_URL") || "http://localhost:3000";

// CLI args
const argv = process.argv.slice(2);
const flagVal = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const RUNS         = parseInt(flagVal("--runs") ?? "5", 10);
const EMAIL_FILTER = flagVal("--email");

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function makeClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("❌  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function fetchCase(supabase) {
  let doctorId = null;

  if (EMAIL_FILTER) {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(`auth.admin.listUsers: ${error.message}`);
    const match = users.find((u) => u.email === EMAIL_FILTER);
    if (!match) throw new Error(`No auth user found with email: ${EMAIL_FILTER}`);
    doctorId = match.id;
  }

  let q = supabase
    .from("consultations")
    .select("id,form_data,doctor_id")
    .not("analyzed_at", "is", null)
    .not("form_data", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(1);

  if (doctorId) q = q.eq("doctor_id", doctorId);

  const { data, error } = await q;
  if (error) throw new Error(`consultations query: ${error.message}`);
  if (!data || data.length === 0) throw new Error("No analyzed consultations found.");
  return data[0];
}

// ---------------------------------------------------------------------------
// Analyze via /api/analyze
// ---------------------------------------------------------------------------

async function runOnce(formData, runIdx) {
  if (!ASSESS_KEY) {
    throw new Error("ASSESSMENT_API_KEY missing from .env.local");
  }
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Assessment-Key": ASSESS_KEY,
      },
      body: JSON.stringify({ form: formData, maxTokens: 1200 }),
    });
  } catch (err) {
    throw new Error(
      `Network error on run ${runIdx + 1} — is dev server running at ${BASE_URL}?\n  ${err.message}`
    );
  }
  const latency = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Run ${runIdx + 1}: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return {
    // API returns { result: AnalysisResult, raw: AnalysisJson, repairedJson, model }
    result: json.result ?? json,
    repairedJson: json.repairedJson ?? false,
    model: json.model ?? "?",
    latency,
  };
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

const ARRAY_FIELDS = ["重点结论", "风险与提醒", "建议优化", "可选思路", "随访监测"];
const OBJECT_FIELD = "当前思路";
const OBJECT_SUBS  = ["可取之处", "需要复核"];

function arr(obj, ...keys) {
  let cur = obj;
  for (const k of keys) cur = cur?.[k];
  return Array.isArray(cur) ? cur.map(String) : [];
}

function truncate(s, n = 72) {
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

function consistencyLabel(results, getter) {
  const counts = results.map((r) => getter(r).length);
  const min = Math.min(...counts), max = Math.max(...counts);
  const allEmpty = max === 0;
  const countConsistent = min === max;
  return { allEmpty, countConsistent, min, max };
}

function printFieldRows(results, getter, indent = "    ") {
  results.forEach((r, i) => {
    const items = getter(r);
    if (items.length === 0) {
      console.log(`${indent}run${i + 1}: (empty)`);
    } else {
      items.forEach((item, j) => {
        console.log(`${indent}run${i + 1}[${j + 1}]: ${truncate(item)}`);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(caseRow, runs) {
  const fd       = caseRow.form_data ?? {};
  const caseDesc = `${fd.patientSex ?? "?"}${fd.patientAge ?? "?"}岁 "${truncate(String(fd.chiefComplaint ?? ""), 40)}"`;
  const results  = runs.map((r) => r.result);
  const sep      = "═".repeat(72);
  const thin     = "─".repeat(72);

  console.log("\n" + sep);
  console.log("  Consistency Report");
  console.log(sep);
  console.log(`  Case     : ${caseDesc}`);
  console.log(`  Dx/Ptn   : ${fd.diagnosis ?? "—"} / ${fd.pattern ?? "—"}`);
  console.log(`  Endpoint : ${BASE_URL}/api/analyze`);
  console.log(`  Runs     : ${RUNS}`);
  console.log(thin);

  // ── Run summary table ──────────────────────────────────────────────────
  console.log("\n  Run-level summary:");
  console.log("  " + ["Run", "Latency", "criticalRisk", "repairedJson", "Model"].map((h, i) =>
    [4, 8, 14, 13, 24][i] ? h.padEnd([4, 8, 14, 13, 24][i]) : h
  ).join("  "));

  runs.forEach((r, i) => {
    const cr = r.result.criticalRisk != null
      ? `🔴 ${truncate(r.result.criticalRisk.summary ?? "triggered", 30)}`
      : "  null";
    console.log(
      `  ${String(i + 1).padEnd(4)}  ${String(r.latency + "ms").padEnd(8)}  ${cr.padEnd(14)}  ${String(r.repairedJson).padEnd(13)}  ${r.model}`
    );
  });

  // ── criticalRisk consistency ───────────────────────────────────────────
  const crFired = results.filter((r) => r.criticalRisk != null).length;
  let crLine;
  if      (crFired === 0)         crLine = `✅  Never fired   (0/${RUNS})`;
  else if (crFired === RUNS)      crLine = `🔴  Always fired  (${RUNS}/${RUNS})`;
  else                             crLine = `⚠️   INCONSISTENT  fired ${crFired}/${RUNS} times`;
  console.log(`\n  criticalRisk : ${crLine}`);

  // ── Array fields ───────────────────────────────────────────────────────
  let hasWarning = false;

  for (const key of ARRAY_FIELDS) {
    const getter = (r) => arr(r, key);
    const { allEmpty, countConsistent, min, max } = consistencyLabel(results, getter);
    if (allEmpty) continue;

    const badge = countConsistent ? "  " : "⚠️ ";
    if (!countConsistent) hasWarning = true;

    console.log(`\n  ${badge}${key}:`);
    printFieldRows(results, getter);
    if (!countConsistent) {
      console.log(`    ⚠️  item count varies across runs: min=${min} max=${max}`);
    }
  }

  // ── 当前思路 sub-fields ────────────────────────────────────────────────
  for (const sub of OBJECT_SUBS) {
    const getter = (r) => arr(r, OBJECT_FIELD, sub);
    const { allEmpty, countConsistent, min, max } = consistencyLabel(results, getter);
    if (allEmpty) continue;

    const badge = countConsistent ? "  " : "⚠️ ";
    if (!countConsistent) hasWarning = true;

    console.log(`\n  ${badge}${OBJECT_FIELD}.${sub}:`);
    printFieldRows(results, getter);
    if (!countConsistent) {
      console.log(`    ⚠️  item count varies: min=${min} max=${max}`);
    }
  }

  // ── Overall verdict ────────────────────────────────────────────────────
  const latencies   = runs.map((r) => r.latency);
  const latAvg      = Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length);
  const latMax      = Math.max(...latencies);
  const anyRepaired = runs.some((r) => r.repairedJson);

  console.log("\n" + thin);
  console.log(`  Latency    avg ${latAvg}ms  max ${latMax}ms`);
  if (anyRepaired) console.log("  ⚠️  One or more runs required JSON repair");

  const crOk = crFired === 0 || crFired === RUNS;
  if (crOk && !hasWarning) {
    console.log("  Verdict    ✅  CONSISTENT across all runs");
  } else {
    const reasons = [];
    if (!crOk) reasons.push("criticalRisk fires intermittently");
    if (hasWarning) reasons.push("item counts vary in one or more fields");
    console.log(`  Verdict    ⚠️  INCONSISTENCY DETECTED — ${reasons.join("; ")}`);
  }
  console.log(sep + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nFetching one recent case...");
  const supabase = makeClient();
  const caseRow  = await fetchCase(supabase);

  const fd = caseRow.form_data ?? {};
  console.log(`→ ${fd.patientSex ?? "?"}${fd.patientAge ?? "?"}岁 "${String(fd.chiefComplaint ?? "").slice(0, 40)}"`);
  console.log(`  Dx: ${fd.diagnosis ?? "—"}  Ptn: ${fd.pattern ?? "—"}`);
  console.log(`\nRunning ${RUNS}× against ${BASE_URL} ...\n`);

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  Run ${i + 1}/${RUNS} ... `);
    const run = await runOnce(fd, i);
    runs.push(run);
    console.log(`done  ${run.latency}ms${run.repairedJson ? "  (repaired)" : ""}`);
    if (i < RUNS - 1) await new Promise((r) => setTimeout(r, 600));
  }

  printReport(caseRow, runs);
}

main().catch((err) => {
  console.error("\n❌ ", err.message);
  process.exit(1);
});
