import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { HistoricalLlmPayload } from "@/lib/historical/schema";
import { historicalLlmPayloadSchema } from "@/lib/historical/schema";
import { writeJsonFile } from "./common";

type DoctorMapEntry = {
  email: string;
  displayName?: string;
  note?: string;
};

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    "doctor-map": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.input || !values["doctor-map"]) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/historical/upsert.ts --input <llm_payload.json> --doctor-map <doctor_map.json> [--dry-run|--apply]");
  process.exit(1);
}

const inputPath = resolve(values.input);
const doctorMapPath = resolve(values["doctor-map"]);
const dryRun = values["dry-run"] || !values.apply;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function loadPayload() {
  return historicalLlmPayloadSchema.parse(JSON.parse(readFileSync(inputPath, "utf8")) as unknown);
}

function loadDoctorMap() {
  return JSON.parse(readFileSync(doctorMapPath, "utf8")) as Record<string, DoctorMapEntry>;
}

async function ensureAllowlistEntry(email: string, mapping: DoctorMapEntry, doctorExternalId: string) {
  // INSERT only — never overwrite is_admin or is_active for existing rows.
  // If a real doctor/admin was already in the allowlist, we must not touch their role or status.
  const displayName = mapping.displayName ?? `Imported ${doctorExternalId}`;
  const note = mapping.note ?? `historical placeholder for ${doctorExternalId}`;

  const { error: insertError } = await supabase
    .from("doctor_allowlist")
    .insert({ email, is_active: true, is_admin: false, display_name: displayName, note });

  if (!insertError) return; // new row inserted cleanly

  if (insertError.code !== "23505") {
    // 23505 = unique_violation (row already exists) — anything else is a real error
    throw new Error(`Failed to insert allowlist for ${doctorExternalId}: ${insertError.message}`);
  }

  // Row already exists: only update metadata fields, never touch is_active or is_admin
  const { error: updateError } = await supabase
    .from("doctor_allowlist")
    .update({ display_name: displayName, note })
    .eq("email", email);

  if (updateError) {
    throw new Error(`Failed to update allowlist metadata for ${doctorExternalId}: ${updateError.message}`);
  }
}

async function listAllUsers() {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

async function ensurePlaceholderUser(
  doctorExternalId: string,
  map: Record<string, DoctorMapEntry>,
  usersByEmail: Map<string, { id: string; email?: string | null }>,
) {
  const mapping = map[doctorExternalId];
  if (!mapping) {
    throw new Error(`Missing doctor map entry for ${doctorExternalId}`);
  }

  const email = mapping.email.trim().toLowerCase();
  const existing = usersByEmail.get(email);
  if (existing) {
    if (!dryRun) {
      await ensureAllowlistEntry(email, mapping, doctorExternalId);
    }
    return {
      doctorExternalId,
      email,
      doctorId: existing.id,
      created: false,
    };
  }

  if (dryRun) {
    return {
      doctorExternalId,
      email,
      doctorId: null,
      created: false,
      wouldCreate: true,
    };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `HistImport-${Math.random().toString(36).slice(2)}!`,
    user_metadata: {
      historical_placeholder: true,
      doctor_external_id: doctorExternalId,
    },
  });

  if (error || !data.user) {
    throw new Error(`Failed to create placeholder auth user for ${doctorExternalId}: ${error?.message ?? "unknown error"}`);
  }

  usersByEmail.set(email, { id: data.user.id, email });

  await ensureAllowlistEntry(email, mapping, doctorExternalId);

  return {
    doctorExternalId,
    email,
    doctorId: data.user.id,
    created: true,
  };
}

async function prepareDoctorResolution(payload: HistoricalLlmPayload, map: Record<string, DoctorMapEntry>) {
  const users = await listAllUsers();
  const usersByEmail = new Map(users.map((user) => [user.email?.toLowerCase() ?? "", user]));
  const uniqueDoctors = Array.from(new Set(payload.records.map((record) => record.doctorExternalId)));
  const resolved = [];

  for (const doctorExternalId of uniqueDoctors) {
    resolved.push(await ensurePlaceholderUser(doctorExternalId, map, usersByEmail));
  }

  return resolved;
}

async function upsertRows(payload: HistoricalLlmPayload, resolutions: Awaited<ReturnType<typeof prepareDoctorResolution>>) {
  const resolutionMap = new Map(resolutions.map((row) => [row.doctorExternalId, row]));
  const rows = payload.records.map((record) => {
    const resolution = resolutionMap.get(record.doctorExternalId);
    if (!resolution?.doctorId && !dryRun) {
      throw new Error(`No resolved doctor_id for ${record.doctorExternalId}`);
    }

    return {
      doctor_id: resolution?.doctorId || "00000000-0000-0000-0000-000000000000",
      doctor_email: resolution?.email || "",
      consultation_name: record.formData.consultationName,
      case_id: record.caseId,
      case_id_updated_at: new Date().toISOString(),
      related_case_id: record.relatedCaseId,
      related_case_id_updated_at: record.relatedCaseId ? new Date().toISOString() : null,
      form_data: record.formData,
      model_meta: {
        imported: true,
        source: payload.sourceLabel,
        ingestion_batch: payload.batchName,
        ingestion_stage: payload.sampleMode ? "sample" : "full",
        doctor_external_id: record.doctorExternalId,
        source_patient_id: record.sourcePatientId,
        historical_record_id: record.recordId,
        llm_prompt_version: record.llmMeta.promptVersion,
        llm_model: record.llmMeta.model,
      },
      analysis_status: "draft",
      analysis_result: null,
      analysis_raw: null,
      analysis_stale: false,
      ai_feedback: null,
      ai_feedback_updated_at: null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      analyzed_at: null,
    };
  });

  if (dryRun) {
    return {
      wouldUpsert: rows.length,
    };
  }

  const batchSize = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("consultations")
      .upsert(batch, { onConflict: "doctor_id,case_id" });

    if (error) {
      throw new Error(`Consultation upsert failed for rows ${i + 1}-${i + batch.length}: ${error.message}`);
    }
    upserted += batch.length;
  }

  return { upserted };
}

async function main() {
  const payload = loadPayload();
  const doctorMap = loadDoctorMap();
  const resolutions = await prepareDoctorResolution(payload, doctorMap);
  const upsertResult = await upsertRows(payload, resolutions);

  const reportPath = join(dirname(inputPath), "resolved_doctor_map.json");
  writeJsonFile(reportPath, {
    batchName: payload.batchName,
    dryRun,
    resolvedDoctors: resolutions,
    upsertResult,
  });

  if (dryRun) {
    console.log(`[historical-upsert] dry run ready. Report: ${reportPath}`);
    return;
  }

  console.log(`[historical-upsert] applied successfully. Report: ${reportPath}`);
}

main().catch((error) => {
  console.error("[historical-upsert] fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
