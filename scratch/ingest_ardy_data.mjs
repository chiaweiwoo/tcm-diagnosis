#!/usr/bin/env node
/**
 * scratch/ingest_ardy_data.mjs
 *
 * Safe database runner for populating doctor ardytcm@gmail.com's May historical consultations.
 * Performs a programmatic backup of existing consultations on disk, prints audit stats,
 * deletes old records (yesterday inclusive), and inserts 173 cleaned records with restored feedbacks.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

// 1. Env validation
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("=== INGESTION PIPELINE START ===");

  // 2. Resolve Doctor UUID
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

  // 3. Perform Pre-Ingestion Programmatic Backup to Local Disk
  console.log("Creating offline backup of current consultations to disk...");
  const { data: currentRows, error: backupError } = await supabase
    .from("consultations")
    .select("*")
    .order("created_at", { ascending: true });

  if (backupError) {
    console.error("Error backing up consultations:", backupError.message);
    process.exit(1);
  }

  const backupFile = "output/consultations_backup_260523.json";
  writeFileSync(backupFile, JSON.stringify(currentRows, null, 2), "utf8");
  console.log(`✓ Programmatic offline backup created: ${currentRows.length} rows written to ${backupFile}`);

  // Create SQL Backup Helper File
  const sqlBackupFile = "scratch/create_backup_table.sql";
  const sqlBackupQuery = `CREATE TABLE IF NOT EXISTS public.consultations_bk_260523 AS\nSELECT * FROM public.consultations;\n`;
  writeFileSync(sqlBackupFile, sqlBackupQuery, "utf8");
  console.log(`✓ SQL Dashboard Backup query written to ${sqlBackupFile}\n`);

  // 4. Audit & Delete Target Old Records
  console.log("Auditing consultations targeting deletion (pre-May 23 inclusive)...");
  const cutOffLocal = "2026-05-23T00:00:00+08:00";
  const cutOffLocalMs = new Date(cutOffLocal).getTime();

  const toDelete = currentRows.filter(row => {
    const isArdy = row.doctor_email?.toLowerCase() === email;
    const rowMs = new Date(row.created_at).getTime();
    return isArdy && rowMs < cutOffLocalMs;
  });

  const toKeep = currentRows.filter(row => {
    const isArdy = row.doctor_email?.toLowerCase() === email;
    const rowMs = new Date(row.created_at).getTime();
    return isArdy && rowMs >= cutOffLocalMs;
  });

  console.log(`Audit results:`);
  console.log(`  - Total current consultations: ${currentRows.length}`);
  console.log(`  - Consultations to delete (yesterday inclusive): ${toDelete.length}`);
  console.log(`  - Consultations to preserve (created today): ${toKeep.length}`);

  if (toDelete.length > 0) {
    console.log("\nList of cases to be deleted:");
    toDelete.forEach((row, i) => {
      console.log(`  [${i + 1}/${toDelete.length}] Case ID: ${row.case_id} | Created: ${row.created_at} | Diag: ${row.form_data?.diagnosis}`);
    });

    console.log("\nExecuting deletion of targeted consultations from Supabase...");
    const { error: delError } = await supabase
      .from("consultations")
      .delete()
      .eq("doctor_id", doctorId)
      .lt("created_at", cutOffLocal);

    if (delError) {
      console.error("Error executing deletion:", delError.message);
      process.exit(1);
    }
    console.log("✓ Deletion executed successfully.");
  } else {
    console.log("No consultations found matching deletion criteria.");
  }

  // 5. Read Ingestion Payload & Insert Cleaned Records
  console.log("\nReading ingestion clinical records payload from JSON...");
  let insertPayload;
  try {
    const rawJSON = readFileSync("scratch/insert_ardy_data.json", "utf8");
    insertPayload = JSON.parse(rawJSON);
  } catch (err) {
    console.error("Error: could not read scratch/insert_ardy_data.json. Please run clean_historical_data.py first.");
    process.exit(1);
  }

  console.log(`Found ${insertPayload.length} cleaned May records to insert.`);

  // Map doctor_id UUID dynamically
  const preparedRows = insertPayload.map(row => {
    return {
      id: row.id,
      doctor_email: email,
      doctor_id: doctorId,
      case_id: row.case_id,
      related_case_id: row.related_case_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      form_data: row.form_data,
      model_meta: { imported: true, source: "nova_data_may" },
      analysis_status: "draft",
      ai_feedback: row.ai_feedback,
      ai_feedback_updated_at: row.ai_feedback_updated_at
    };
  });

  console.log("\nExecuting bulk insertion into Supabase...");
  // Split into batches of 100 rows for stable transactional execution
  const batchSize = 100;
  let insertedCount = 0;

  for (let i = 0; i < preparedRows.length; i += batchSize) {
    const batch = preparedRows.slice(i, i + batchSize);
    const { error: insertError } = await supabase.from("consultations").insert(batch);
    
    if (insertError) {
      console.error(`Error inserting batch [${i} to ${i + batch.length}]:`, insertError.message);
      process.exit(1);
    }
    insertedCount += batch.length;
    console.log(`  Inserted rows ${insertedCount}/${preparedRows.length}...`);
  }

  console.log("\n✓ Ingestion completed successfully!");
  console.log(`Summary:`);
  console.log(`  - Preserved today's tests: ${toKeep.length} rows`);
  console.log(`  - Imported May consultations: ${insertedCount} rows`);
  
  // Verify final count
  const { count, error: countError } = await supabase
    .from("consultations")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", doctorId);

  if (!countError) {
    console.log(`  - Final active consultations count for ${email} in Supabase: ${count} rows`);
  }

  console.log("\n=== INGESTION PIPELINE END ===");
}

main().catch(err => {
  console.error("Unhandled execution error:", err);
  process.exit(1);
});
