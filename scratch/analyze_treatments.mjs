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

console.log("Fetching all consultations from Supabase to analyze treatments...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, form_data");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

console.log(`Successfully fetched ${data.length} consultations.`);

const typeCounts = {};
const herbalPrescriptions = [];
const acupuncturePrescriptions = [];
const otherPrescriptions = [];

for (const row of data) {
  const form = row.form_data;
  if (!form) continue;

  const type = form.prescriptionType || "未分类";
  typeCounts[type] = (typeCounts[type] || 0) + 1;

  const prescription = form.prescription || "";
  const diagnosis = form.diagnosis || "未知";
  const pattern = form.pattern || "未知";

  if (type === "方药" || (Array.isArray(type) && type.includes("方药"))) {
    herbalPrescriptions.push({ prescription, diagnosis, pattern });
  } else if (type === "针灸" || (Array.isArray(type) && type.includes("针灸"))) {
    acupuncturePrescriptions.push({ prescription, diagnosis, pattern });
  } else {
    otherPrescriptions.push({ prescription, diagnosis, pattern, type });
  }
}

console.log("\n--- PRESCRIPTION TYPE DISTRIBUTION ---");
console.log(JSON.stringify(typeCounts, null, 2));

console.log("\n--- SAMPLE ACUPUNCTURE TREATMENTS (Top 15) ---");
acupuncturePrescriptions.slice(0, 15).forEach((p, idx) => {
  console.log(`${idx + 1}. Diagnosis: ${p.diagnosis} | Pattern: ${p.pattern}`);
  console.log(`   Prescription: "${p.prescription.replace(/\n/g, ' ')}"`);
});

console.log("\n--- SAMPLE HERBAL TREATMENTS (Top 15) ---");
herbalPrescriptions.slice(0, 15).forEach((p, idx) => {
  console.log(`${idx + 1}. Diagnosis: ${p.diagnosis} | Pattern: ${p.pattern}`);
  console.log(`   Prescription: "${p.prescription.replace(/\n/g, ' ')}"`);
});

// Let's also do a simple word frequency or pattern analysis on the treatments
const herbsFrequency = {};
const acupointsFrequency = {};

// Simple heuristic: split herbal prescriptions by space, comma, or chinese characters
for (const p of herbalPrescriptions) {
  const words = p.prescription.split(/[\s,，、；;+\n]+/);
  for (const w of words) {
    const clean = w.trim().replace(/\d+g?$/, ""); // remove dosage like 10g or 10
    if (clean.length >= 2 && clean.length <= 4) {
      herbsFrequency[clean] = (herbsFrequency[clean] || 0) + 1;
    }
  }
}

// Simple heuristic: split acupuncture by space, comma, or chinese characters
for (const p of acupuncturePrescriptions) {
  const words = p.prescription.split(/[\s,，、；;+\n]+/);
  for (const w of words) {
    const clean = w.trim();
    if (clean.length >= 2 && clean.length <= 4) {
      acupointsFrequency[clean] = (acupointsFrequency[clean] || 0) + 1;
    }
  }
}

const topHerbs = Object.entries(herbsFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

const topAcupoints = Object.entries(acupointsFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

console.log("\n--- MOST FREQUENT HERBAL ELEMENTS/FORMULAS ---");
topHerbs.forEach(([word, count]) => {
  console.log(`- ${word}: ${count} times`);
});

console.log("\n--- MOST FREQUENT ACUPOINTS/METHODS ---");
topAcupoints.forEach(([word, count]) => {
  console.log(`- ${word}: ${count} times`);
});
