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

const { data, error } = await supabase
  .from("consultations")
  .select("id, ai_feedback, ai_feedback_updated_at, created_at, doctor_email")
  .eq("id", "1d9b3e35-0ebf-4928-92e4-9c66ae6cf641")
  .single();

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

console.log("--- CHIAWEI FEEDBACK DETAILS ---");
console.log(JSON.stringify(data, null, 2));
