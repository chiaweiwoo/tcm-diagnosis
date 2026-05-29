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

console.log("Verifying backup table consultations_bk_260523 in Supabase...");

const { data, error, count } = await supabase
  .from("consultations_bk_260523")
  .select("id", { count: "exact", head: true });

if (error) {
  console.error("Verification failed:", error.message);
  console.log("Suggestion: Make sure the table consultations_bk_260523 was created successfully in the dashboard.");
  process.exit(1);
}

console.log(`✓ Safety verification passed! Backup table exists and contains: ${count} rows.`);
