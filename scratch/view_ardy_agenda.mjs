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

const doctorId = "45f8217f-b4d4-483f-9284-c78d7062b787";

const { data, error } = await supabase
  .from("doctor_discussion_agenda")
  .select("*")
  .eq("doctor_id", doctorId)
  .maybeSingle();

if (error) {
  console.error("Error:", error);
} else {
  console.log("Stored Agenda for Ardy:", JSON.stringify(data, null, 2));
}
