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

console.log("Querying database to analyze doctor emails and their feedbacks...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, doctor_email, ai_feedback");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

const doctorStats = {};

for (const row of data) {
  const email = row.doctor_email || "unknown";
  if (!doctorStats[email]) {
    doctorStats[email] = {
      total: 0,
      nullFeedback: 0,
      emptyFeedback: 0,
      actualFeedback: 0,
      feedbacks: []
    };
  }

  doctorStats[email].total++;
  
  if (row.ai_feedback === null) {
    doctorStats[email].nullFeedback++;
  } else if (typeof row.ai_feedback === "string" && row.ai_feedback.trim() === "") {
    doctorStats[email].emptyFeedback++;
  } else {
    doctorStats[email].actualFeedback++;
    doctorStats[email].feedbacks.push({
      id: row.id,
      feedback: row.ai_feedback
    });
  }
}

console.log("--- DOCTOR STATS OVERVIEW ---");
console.log(JSON.stringify(doctorStats, null, 2));
