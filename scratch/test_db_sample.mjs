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

console.log("Fetching a sample consultation row from Supabase...");
const { data, error } = await supabase
  .from("consultations")
  .select("*")
  .limit(1);

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log("No consultations found in the database.");
} else {
  console.log("--- SAMPLE ROW ---");
  console.log(JSON.stringify(data[0], null, 2));
}
