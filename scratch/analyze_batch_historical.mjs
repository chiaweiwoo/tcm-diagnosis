#!/usr/bin/env node
/**
 * scratch/analyze_batch_historical.mjs
 *
 * Runs batch DeepSeek clinical analysis on all draft historical records for doctor ardytcm@gmail.com.
 * Uses rate-limiting to prevent rate-limits (sequential execution) and calls the canonical /api/analyze.
 *
 * Usage:
 *   node --env-file=.env.local scratch/analyze_batch_historical.mjs [--limit 10]
 */

import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

// Args
const { values } = parseArgs({
  options: {
    limit: { type: "string" },
  },
  strict: true,
});

const limitVal = values.limit ? parseInt(values.limit, 10) : null;

// Env validation
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const assessKey = process.env.ASSESSMENT_API_KEY;
const baseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!supabaseUrl || !serviceKey || !assessKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ASSESSMENT_API_KEY must be set in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("=== BATCH CLINICAL ANALYSIS PIPELINE START ===");
  console.log(`Base Server URL: ${baseUrl}`);

  // 1. Resolve Doctor UUID
  const email = "ardytcm@gmail.com";
  console.log(`Resolving UUID for doctor: ${email}...`);
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error("Error listing auth.users:", listError.message);
    process.exit(1);
  }

  const doctorUser = usersData.users.find((u) => u.email?.toLowerCase() === email);
  if (!doctorUser) {
    console.error(`Error: no auth.users row found for ${email}.`);
    process.exit(1);
  }

  const doctorId = doctorUser.id;
  console.log(`✓ Doctor UUID resolved: ${doctorId}\n`);

  // 2. Query draft consultations
  console.log("Querying 'draft' consultations for doctor...");
  let query = supabase
    .from("consultations")
    .select("id, case_id, form_data, created_at")
    .eq("doctor_id", doctorId)
    .eq("analysis_status", "draft")
    .order("created_at", { ascending: true });

  if (limitVal) {
    console.log(`Limiting analysis to the first ${limitVal} records.`);
    query = query.limit(limitVal);
  }

  const { data: drafts, error: queryError } = await query;
  if (queryError) {
    console.error("Error querying drafts:", queryError.message);
    process.exit(1);
  }

  console.log(`✓ Found ${drafts.length} draft consultations requiring DeepSeek clinical analysis.\n`);

  if (drafts.length === 0) {
    console.log("All consultations are already analyzed! Nothing to do.");
    console.log("=== PIPELINE END ===");
    process.exit(0);
  }

  // 3. Sequential rate-limited execution
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < drafts.length; i++) {
    const record = drafts[i];
    const label = `[${i + 1}/${drafts.length}] Case ID: ${record.case_id} (DB ID: ${record.id})`;
    console.log(`Processing ${label}...`);

    try {
      // Step A: Call API analyze route (uses the canonical prompt + langfuse logger)
      const res = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Assessment-Key": assessKey,
        },
        body: JSON.stringify({ form: record.form_data, maxTokens: 2500 }),
      });

      if (!res.ok) {
        const errMsg = await res.text();
        throw new Error(`API analyze failed with status ${res.status}: ${errMsg.slice(0, 200)}`);
      }

      const resData = await res.json();
      const analysisResult = resData.result;
      const analysisRaw = resData.raw;
      const modelMeta = {
        model: resData.model,
        promptVersion: resData.promptVersion,
        repairedJson: resData.repairedJson ?? false,
      };

      // Step B: Save analysis output back to DB row and mark analyzed
      const { error: updateError } = await supabase
        .from("consultations")
        .update({
          analysis_result: analysisResult,
          analysis_raw: analysisRaw,
          model_meta: modelMeta,
          analysis_status: "analyzed",
          analyzed_at: record.created_at,
          analysis_stale: false
        })
        .eq("id", record.id);

      if (updateError) {
        throw new Error(`Failed to update DB consultation row: ${updateError.message}`);
      }

      successCount++;
      console.log(`  ✓ Successfully analyzed and saved.`);

    } catch (err) {
      failCount++;
      console.error(`  ✗ Failed: ${err.message}`);
    }

    // Small delay (e.g. 700ms) to respect rate limits
    await sleep(700);
  }

  console.log(`\n=== BATCH CLINICAL ANALYSIS PIPELINE COMPLETED ===`);
  console.log(`Summary:`);
  console.log(`  - Successfully analyzed: ${successCount}`);
  console.log(`  - Failed: ${failCount}`);
  console.log(`=== BATCH CLINICAL ANALYSIS PIPELINE END ===`);
  
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error("Unhandled execution error:", err);
  process.exit(1);
});
