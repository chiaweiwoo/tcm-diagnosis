import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { evaluateDoctor, insertDoctorEvaluation } from "../src/lib/analytics/evaluation";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// 1. Load env
loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

// 2. Parse CLI arguments
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    doctorId: { type: "string" },
    windowDays: { type: "string", default: "7" },
  },
  strict: true,
});

const windowDays = Number(values.windowDays || "7");
if (isNaN(windowDays) || windowDays <= 0 || windowDays > 90) {
  console.error("Error: windowDays must be a valid number between 1 and 90.");
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

// 3. Resolve active doctor target(s)
async function resolveDoctors() {
  const targetEmail = values.email?.trim();
  const targetId = values.doctorId?.trim();

  // If a specific ID is provided, query allowlist directly to map email
  if (targetId) {
    const { data: allow } = await client
      .from("doctor_allowlist")
      .select("email")
      .eq("is_active", true)
      .maybeSingle();

    return [{ doctorId: targetId, email: allow?.email || "unknown" }];
  }

  // Fetch all active allowlist entries
  const { data: allowlist, error: err1 } = await client
    .from("doctor_allowlist")
    .select("email")
    .eq("is_active", true);

  if (err1) throw err1;
  if (!allowlist || allowlist.length === 0) return [];

  // Query auth.users to map email -> doctor_id (UUID)
  const { data: users, error: err2 } = await client.auth.admin.listUsers();
  if (err2) throw err2;

  const emailToId = new Map<string, string>();
  for (const u of users.users) {
    if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
  }

  const targets: Array<{ doctorId: string; email: string }> = [];
  for (const row of allowlist) {
    const emailLower = row.email.toLowerCase();
    const id = emailToId.get(emailLower);
    if (id) {
      if (targetEmail && targetEmail.toLowerCase() !== emailLower) {
        continue;
      }
      targets.push({ doctorId: id, email: row.email });
    }
  }

  return targets;
}

async function main() {
  console.log("[evaluate-local] Initializing process-level evaluation...");
  let doctors;
  try {
    doctors = await resolveDoctors();
  } catch (error) {
    console.error("Failed to resolve active doctors from allowlist/auth:", error);
    process.exit(1);
  }

  if (doctors.length === 0) {
    console.warn("No active doctors resolved for evaluation.");
    process.exit(0);
  }

  console.log(`[evaluate-local] Found ${doctors.length} doctor(s) to process. windowDays=${windowDays}`);

  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const doc of doctors) {
    console.log(`\n----------------------------------------------------------------------`);
    console.log(`Evaluating Doctor: ${doc.email} (${doc.doctorId})`);
    console.log(`----------------------------------------------------------------------`);

    try {
      const { evaluation, consultationCount, model, promptVersion } = await evaluateDoctor(
        client,
        doc.doctorId,
        windowDays
      );

      console.log(`[evaluate-local] Evaluation compiled! model=${model} prompt=${promptVersion} N=${consultationCount}`);

      const evalId = await insertDoctorEvaluation({
        client,
        doctorId: doc.doctorId,
        windowDays,
        evaluation,
        consultationCount,
        model,
      });

      console.log(`[evaluate-local] Saved to analytics_doctor_evaluations successfully! id=${evalId}`);
      processedCount++;
    } catch (error: any) {
      if (error && error.name === "NoConsultationsError") {
        console.log(`[evaluate-local] Skipped: ${error.message}`);
        skippedCount++;
      } else {
        console.error(`[evaluate-local] Failed to evaluate doctor ${doc.email}:`, error);
        failedCount++;
      }
    }
  }

  console.log(`\n======================================================================`);
  console.log(`Done - Processed: ${processedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`);
  console.log(`======================================================================`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
