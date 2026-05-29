import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing DB credentials in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("Fetching detailed feedback records from Supabase...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, ai_feedback, ai_feedback_updated_at, created_at, form_data")
  .eq("doctor_email", "ardytcm@gmail.com");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

const results = data
  .filter(row => row.ai_feedback !== null && row.ai_feedback.trim() !== "")
  .map(row => ({
    id: row.id,
    feedback: row.ai_feedback,
    feedback_updated_at: row.ai_feedback_updated_at || row.created_at, // fallback to created_at if updated_at is null
    diagnosis: row.form_data?.diagnosis || "未知",
    chiefComplaint: row.form_data?.chiefComplaint || "未知"
  }));

console.log("--- DETAILED FEEDBACK DATA ---");
console.log(JSON.stringify(results, null, 2));
