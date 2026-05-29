import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(supabaseUrl, serviceKey);

const { data, error } = await client
  .from("doctor_discussion_agenda")
  .select("*")
  .eq("doctor_id", "45f8217f-b4d4-483f-9284-c78d7062b787")
  .maybeSingle();

console.log("Error:", error);
console.log("Data:", data ? {
  doctor_id: data.doctor_id,
  items_count: data.items?.length,
  window_start: data.window_start,
  window_end: data.window_end,
  source_last_record_at: data.source_last_record_at,
  prompt_version: data.prompt_version,
  computed_at: data.computed_at
} : null);
