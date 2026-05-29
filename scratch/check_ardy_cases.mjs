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

// 1. Get latest analyzed_at
const { data: latestRow } = await supabase
  .from("consultations")
  .select("analyzed_at")
  .eq("doctor_id", doctorId)
  .not("analyzed_at", "is", null)
  .order("analyzed_at", { ascending: false })
  .limit(1)
  .maybeSingle();

console.log("Latest analyzed_at for Ardy:", latestRow?.analyzed_at);

if (latestRow?.analyzed_at) {
  const latest = new Date(latestRow.analyzed_at);
  const windowEnd = latest;
  const windowStart = new Date(latest);
  windowStart.setDate(windowStart.getDate() - 14);

  console.log(`Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

  const { data: rows } = await supabase
    .from("consultations")
    .select("form_data, analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lte("analyzed_at", windowEnd.toISOString());

  console.log(`Consultations in window: ${rows?.length ?? 0}`);

  // Count groups
  const groups = {};
  for (const r of rows || []) {
    const fd = r.form_data;
    const d = String(fd.diagnosis || "").trim();
    const p = String(fd.pattern || "").trim();
    const m = String(fd.prescriptionType || fd.prescription_type || "方药").trim();
    if (d.match(/\$|GST|receipt|membership/i) || p.match(/\$|GST|receipt|Corbett/i)) {
      continue;
    }
    if (!d || !p) continue;
    const key = `${d} × ${p} × ${m}`;
    groups[key] = (groups[key] || 0) + 1;
  }

  console.log("\nGroups (all):", groups);
  
  const filtered = Object.entries(groups).filter(([_, count]) => count >= 2);
  console.log("\nGroups with N >= 2:", filtered);
}
