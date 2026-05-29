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

console.log("Fetching consultations to analyze vague placeholders...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, form_data");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

const billingPatterns = /ROC|Number|receipt|claim|fee|package|split|times\s+left|redeem|trt|con|\$\d+|\b\d+\s+times\b|\b\d+\s+sessions\b/i;
const retailPatterns = /Hairboom|Lipid\s+health|almond|Yuzu|bottle|plaster|敷贴/i;
const acupuncturePatterns = /针刺|针灸|刺络|拔罐|艾灸|阿是|穴|肩井|合谷|阳陵泉|曲池/i;
const classicalFormulas = /汤|丸|散|饮|膏|二陈|六味|保和|逍遥|止嗽|桂枝/i;
const herbListPattern = /[\u4e00-\u9fa5]+\s*\d+/;

const placeholders = [];

for (const row of data) {
  const form = row.form_data;
  if (!form) continue;

  const pText = (form.prescription || "").trim();
  const dbType = form.prescriptionType || "未定义";
  const diagnosis = form.diagnosis || "未提供";

  if (!pText) continue;

  const hasBilling = billingPatterns.test(pText);
  const hasRetail = retailPatterns.test(pText);
  const hasAcu = acupuncturePatterns.test(pText);
  const hasHerbs = classicalFormulas.test(pText) || herbListPattern.test(pText) || pText.includes("g") || pText.includes("x3") || pText.includes("x1");

  let isPlaceholder = false;
  if (!hasBilling && !hasRetail && !hasAcu && !hasHerbs) {
    isPlaceholder = true;
  } else if (/^(中药调理|方药中药调理|中药|方药)$/.test(pText)) {
    isPlaceholder = true;
  }

  if (isPlaceholder) {
    placeholders.push({ pText, dbType, diagnosis });
  }
}

// Aggregate by text content
const frequency = {};
for (const item of placeholders) {
  const key = item.pText;
  if (!frequency[key]) {
    frequency[key] = {
      count: 0,
      dbTypes: new Set(),
      diagnoses: new Set()
    };
  }
  frequency[key].count++;
  frequency[key].dbTypes.add(item.dbType);
  frequency[key].diagnoses.add(item.diagnosis);
}

console.log("--- VAGUE PLACEHOLDERS FREQUENCY ---");
const sorted = Object.entries(frequency).sort((a, b) => b[1].count - a[1].count);
for (const [text, info] of sorted) {
  console.log(`\nText: "${text.replace(/\n/g, ' [NL] ')}"`);
  console.log(`Count: ${info.count}`);
  console.log(`DB Types: ${Array.from(info.dbTypes).join(', ')}`);
  console.log(`Diagnoses: ${Array.from(info.diagnoses).slice(0, 5).join(', ')}`);
}
