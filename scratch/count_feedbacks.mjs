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

console.log("Querying database for user feedbacks in consultations...");

// Fetch total rows count
const { count: totalCount, error: totalError } = await supabase
  .from("consultations")
  .select("*", { count: "exact", head: true });

if (totalError) {
  console.error("Error fetching total count:", totalError.message);
  process.exit(1);
}

// Fetch rows with non-null, non-empty ai_feedback
// Note: We can filter for not.is.null and not.eq('') or just fetch all ai_feedback values to check.
// Since we want to be absolutely precise, let's fetch all rows with their id and ai_feedback and count them in memory,
// or use appropriate filters.
const { data, error: queryError } = await supabase
  .from("consultations")
  .select("id, ai_feedback");

if (queryError) {
  console.error("Error fetching consultations:", queryError.message);
  process.exit(1);
}

let feedbackRows = [];
let emptyFeedbackCount = 0;
let nullFeedbackCount = 0;

for (const row of data) {
  if (row.ai_feedback === null) {
    nullFeedbackCount++;
  } else if (typeof row.ai_feedback === "string" && row.ai_feedback.trim() === "") {
    emptyFeedbackCount++;
  } else {
    feedbackRows.push(row);
  }
}

console.log("--- RESULT ---");
console.log(`Total consultations: ${totalCount}`);
console.log(`Rows with NULL feedback: ${nullFeedbackCount}`);
console.log(`Rows with EMPTY/WHITESPACE feedback: ${emptyFeedbackCount}`);
console.log(`Rows with ACTUAL feedback: ${feedbackRows.length}`);

if (feedbackRows.length > 0) {
  console.log("\n--- SAMPLES OF FEEDBACKS ---");
  feedbackRows.slice(0, 10).forEach((row, index) => {
    console.log(`${index + 1}. ID: ${row.id}`);
    console.log(`   Feedback: "${row.ai_feedback}"`);
  });
}
