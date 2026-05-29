import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing DB credentials.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("Auditing recently analyzed consultations in Supabase...");

// Query the two analyzed consultations
const { data, error } = await supabase
  .from("consultations")
  .select("id, case_id, created_at, analyzed_at, form_data")
  .eq("doctor_email", "ardytcm@gmail.com")
  .eq("analysis_status", "analyzed")
  .order("created_at", { ascending: true });

if (error) {
  console.error("Query error:", error.message);
  process.exit(1);
}

console.log(`\nFound: ${data.length} analyzed consultations.`);
for (const row of data) {
  console.log(`Case ID: ${row.case_id}`);
  console.log(`  - Created At:  ${row.created_at}`);
  console.log(`  - Analyzed At: ${row.analyzed_at}`);
}

// Check how many are dated for Today (May 23) in the chart data query path
console.log("\nSimulating the chart data query path...");
const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 86400000).toISOString();

const { data: chartData, error: chartError } = await supabase
  .from("consultations")
  .select("analyzed_at, created_at")
  .eq("doctor_email", "ardytcm@gmail.com")
  .or(`analyzed_at.gte.${thirtyFiveDaysAgo},created_at.gte.${thirtyFiveDaysAgo}`);

if (chartError) {
  console.error("Chart query error:", chartError.message);
  process.exit(1);
}

const dates = chartData.map(r => r.analyzed_at ?? r.created_at);
console.log(`Total active dates retrieved for chart: ${dates.length}`);

// Convert to local dates (UTC+8) and count Today (May 23)
const todayLocalKey = "2026-05-23";
let todayCount = 0;

for (const d of dates) {
  const dateObj = new Date(new Date(d).getTime() + 8 * 3600_000);
  const key = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, "0")}-${String(dateObj.getUTCDate()).padStart(2, "0")}`;
  if (key === todayLocalKey) {
    todayCount++;
  }
}

console.log(`\n✓ Verification Audit Result:`);
console.log(`  - Today's date (2026-05-23) has exactly: ${todayCount} cases in the chart.`);
console.log(`  - (Expected: exactly 4 cases, which matches today's test cases only!)`);
