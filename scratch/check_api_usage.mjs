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

console.log("Analyzing API usage logs for today...");

// Query all API call logs created today (May 23, 2026 UTC/Local)
const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);

const { data, error } = await supabase
  .from("api_call_logs")
  .select("*")
  .gte("created_at", todayStart.toISOString());

if (error) {
  console.error("Error fetching logs:", error.message);
  process.exit(1);
}

console.log(`\nFound: ${data.length} API call logs for today.`);

let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let totalTokens = 0;
let totalCostUsd = 0;
let successCount = 0;
let failCount = 0;

for (const log of data) {
  if (log.success) successCount++;
  else failCount++;
  
  totalPromptTokens += log.prompt_tokens ?? 0;
  totalCompletionTokens += log.completion_tokens ?? 0;
  totalTokens += log.total_tokens ?? 0;
  totalCostUsd += Number(log.cost_usd ?? 0);
}

console.log("\n=== CUMULATIVE API USAGE STATS ===");
console.log(`Success Rate:       ${successCount} successful / ${failCount} failed`);
console.log(`Prompt Tokens:      ${totalPromptTokens.toLocaleString()}`);
console.log(`Completion Tokens:  ${totalCompletionTokens.toLocaleString()}`);
console.log(`Total Tokens:       ${totalTokens.toLocaleString()}`);
console.log(`Estimated Cost:     $${totalCostUsd.toFixed(6)} USD`);
console.log("==================================");
