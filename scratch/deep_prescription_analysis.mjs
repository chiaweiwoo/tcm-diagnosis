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

console.log("Fetching all consultations for realistic text-based treatment analysis...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, form_data");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

const categories = {
  pureAcupuncture: [],
  pureHerbs: [],
  combinedAcuHerbs: [],
  retailSupplements: [],
  administrativeNoise: [],
  vaguePlaceholders: [],
  emptyOrInvalid: []
};

const billingPatterns = /ROC|Number|receipt|claim|fee|package|split|times\s+left|redeem|trt|con|\$\d+|\b\d+\s+times\b|\b\d+\s+sessions\b/i;
const retailPatterns = /Hairboom|Lipid\s+health|almond|Yuzu|bottle|plaster|敷贴/i;
const acupuncturePatterns = /针刺|针灸|刺络|拔罐|艾灸|阿是|穴|肩井|合谷|阳陵泉|曲池/i;
const classicalFormulas = /汤|丸|散|饮|膏|二陈|六味|保和|逍遥|止嗽|桂枝/i;
const herbListPattern = /[\u4e00-\u9fa5]+\s*\d+/; // e.g. "党参 10"

for (const row of data) {
  const form = row.form_data;
  if (!form) {
    categories.emptyOrInvalid.push(row);
    continue;
  }

  const pText = (form.prescription || "").trim();
  const dbType = form.prescriptionType || "未定义";

  if (!pText) {
    categories.emptyOrInvalid.push({ id: row.id, pText, dbType });
    continue;
  }

  const hasBilling = billingPatterns.test(pText);
  const hasRetail = retailPatterns.test(pText);
  const hasAcu = acupuncturePatterns.test(pText);
  const hasHerbs = classicalFormulas.test(pText) || herbListPattern.test(pText) || pText.includes("g") || pText.includes("x3") || pText.includes("x1");

  if (hasBilling && !hasAcu && !hasHerbs && !hasRetail) {
    categories.administrativeNoise.push({ id: row.id, pText, dbType });
  } else if (hasRetail && !hasAcu && !hasHerbs) {
    categories.retailSupplements.push({ id: row.id, pText, dbType });
  } else if (/^(中药调理|方药中药调理|中药|方药)$/.test(pText)) {
    categories.vaguePlaceholders.push({ id: row.id, pText, dbType });
  } else if (hasAcu && hasHerbs) {
    categories.combinedAcuHerbs.push({ id: row.id, pText, dbType });
  } else if (hasAcu) {
    categories.pureAcupuncture.push({ id: row.id, pText, dbType });
  } else if (hasHerbs) {
    categories.pureHerbs.push({ id: row.id, pText, dbType });
  } else {
    if (hasBilling) {
      categories.administrativeNoise.push({ id: row.id, pText, dbType });
    } else {
      categories.vaguePlaceholders.push({ id: row.id, pText, dbType });
    }
  }
}

console.log("\n--- REALISTIC TEXT-BASED CLASSIFICATION ---");
console.log(`1. Pure Acupuncture: ${categories.pureAcupuncture.length} cases`);
console.log(`2. Pure Herbal Prescriptions: ${categories.pureHerbs.length} cases`);
console.log(`3. Combined Acupuncture & Herbs: ${categories.combinedAcuHerbs.length} cases`);
console.log(`4. Retail & Supplements: ${categories.retailSupplements.length} cases`);
console.log(`5. Vague Placeholders (e.g. "中药调理"): ${categories.vaguePlaceholders.length} cases`);
console.log(`6. Administrative/Billing Noise (e.g. ROC, receipts): ${categories.administrativeNoise.length} cases`);
console.log(`7. Empty or Invalid: ${categories.emptyOrInvalid.length} cases`);

console.log("\n--- SAMPLES OF COMBINED ACUPUNCTURE & HERBS ---");
categories.combinedAcuHerbs.slice(0, 5).forEach((item, idx) => {
  console.log(`${idx + 1}. DB Type: "${item.dbType}" | Text: "${item.pText}"`);
});

console.log("\n--- SAMPLES OF RETAIL & SUPPLEMENTS ---");
categories.retailSupplements.slice(0, 5).forEach((item, idx) => {
  console.log(`${idx + 1}. DB Type: "${item.dbType}" | Text: "${item.pText}"`);
});

console.log("\n--- SAMPLES OF ADMINISTRATIVE/BILLING NOISE ---");
categories.administrativeNoise.slice(0, 5).forEach((item, idx) => {
  console.log(`${idx + 1}. DB Type: "${item.dbType}" | Text: "${item.pText}"`);
});

console.log("\n--- SAMPLES OF VAGUE PLACEHOLDERS ---");
categories.vaguePlaceholders.slice(0, 5).forEach((item, idx) => {
  console.log(`${idx + 1}. DB Type: "${item.dbType}" | Text: "${item.pText}"`);
});
