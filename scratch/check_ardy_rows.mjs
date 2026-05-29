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

console.log("Checking consultations for doctor ardytcm@gmail.com...");

// Fetch all consultations for this doctor
const { data, error } = await supabase
  .from("consultations")
  .select("id, created_at, case_id, form_data")
  .eq("doctor_email", "ardytcm@gmail.com")
  .order("created_at", { ascending: true });

if (error) {
  console.error("Error fetching:", error.message);
  process.exit(1);
}

console.log(`\nFound total: ${data.length} consultations.`);

if (data.length > 0) {
  const minDate = data[0].created_at;
  const maxDate = data[data.length - 1].created_at;
  console.log(`Date Range: ${minDate}  -->  ${maxDate}`);
  
  // Count how many are from today (May 23, 2026 local time / UTC)
  const cutOffLocal = "2026-05-23T00:00:00+08:00";
  const cutOffLocalMs = new Date(cutOffLocal).getTime();
  
  let beforeCutoffCount = 0;
  let afterCutoffCount = 0;
  
  for (const row of data) {
    const rowMs = new Date(row.created_at).getTime();
    if (rowMs < cutOffLocalMs) {
      beforeCutoffCount++;
    } else {
      afterCutoffCount++;
    }
  }
  
  console.log(`Records created before May 23 (yesterday inclusive): ${beforeCutoffCount}`);
  console.log(`Records created on/after May 23 (today): ${afterCutoffCount}`);
  
  if (afterCutoffCount > 0) {
    console.log("\n--- RECORDS CREATED TODAY ---");
    for (const row of data) {
      const rowMs = new Date(row.created_at).getTime();
      if (rowMs >= cutOffLocalMs) {
        console.log(`ID: ${row.id}, Case ID: ${row.case_id}, Created At: ${row.created_at}, Diagnosis: ${row.form_data?.diagnosis}`);
      }
    }
  }
}
