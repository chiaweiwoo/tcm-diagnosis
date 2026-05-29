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

console.log("Fetching all consultations for methods and machines categorization...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, form_data");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

// Data structures for classification
const categories = {
  shockwaveMachine: [],       // ESWT / SWT Shockwave Therapy
  tensMachine: [],            // TENS Electrical Nerve Stimulation
  mfrManual: [],              // Myofascial Release (MFR)
  tuinaManual: [],            // Traditional Chinese Tuina / Acupressure
  acupunctureNeedle: [],     // Acupuncture & Traditional Meridian Therapies (Needling, Cupping, Guasha)
  herbalMedicine: [],         // Chinese Herbal Medicine Granules & Formulas
  combinedMultiModal: [],     // Multi-modal treatments (e.g. combining Shockwave + MFR or Needle + Herbs)
  administrativeLog: [],      // Billing codes, packages, pricing tracking, ROC numbers
  genericPlaceholders: []     // Non-specific generic entries like "中药调理"
};

const billingRegex = /ROC|Number|receipt|claim|fee|package|split|times\s+left|redeem|trt|con|\$\d+|\b\d+\s+times\b|\b\d+\s+sessions\b/i;
const shockwaveRegex = /ESWT|SWT|shockwave/i;
const tensRegex = /TENS/i;
const mfrRegex = /MFR/i;
const tuinaRegex = /推拿|Tuina|Acupressure|facial/i;
const acupunctureRegex = /针刺|针灸|刺络|拔罐|艾灸|阿是|穴|肩井|合谷|阳陵泉|曲池/i;
const herbalRegex = /汤|丸|散|饮|膏|二陈|六味|保和|逍遥|止嗽|桂枝|[\u4e00-\u9fa5]+\s*\d+|g\b|x3\b|x1\b/i;

for (const row of data) {
  const form = row.form_data;
  if (!form) continue;

  const pText = (form.prescription || "").trim();
  const dbType = form.prescriptionType || "未定义";
  const diagnosis = form.diagnosis || "未提供";

  if (!pText) continue;

  // Track match counts to identify multi-modal treatments
  const hasShockwave = shockwaveRegex.test(pText);
  const hasTens = tensRegex.test(pText);
  const hasMfr = mfrRegex.test(pText);
  const hasTuina = tuinaRegex.test(pText);
  const hasAcupuncture = acupunctureRegex.test(pText);
  const hasHerbal = herbalRegex.test(pText) && !pText.includes("ROC");
  const hasBilling = billingRegex.test(pText);

  // Count active clinical treatment types mentioned in the text
  let activeClinicalTypes = 0;
  if (hasShockwave) activeClinicalTypes++;
  if (hasTens) activeClinicalTypes++;
  if (hasMfr) activeClinicalTypes++;
  if (hasTuina) activeClinicalTypes++;
  if (hasAcupuncture) activeClinicalTypes++;
  if (hasHerbal && !/^(中药调理|方药中药调理|中药|方药)$/.test(pText)) activeClinicalTypes++;

  const details = { id: row.id, pText, dbType, diagnosis };

  // 1. Combined Multi-Modal Treatments
  if (activeClinicalTypes > 1) {
    categories.combinedMultiModal.push(details);
  }
  // 2. Pure ESWT/SWT Shockwave Therapy
  else if (hasShockwave) {
    categories.shockwaveMachine.push(details);
  }
  // 3. Pure TENS
  else if (hasTens) {
    categories.tensMachine.push(details);
  }
  // 4. Pure MFR
  else if (hasMfr) {
    categories.mfrManual.push(details);
  }
  // 5. Pure Tuina
  else if (hasTuina) {
    categories.tuinaManual.push(details);
  }
  // 6. Pure Acupuncture
  else if (hasAcupuncture) {
    categories.acupunctureNeedle.push(details);
  }
  // 7. Pure Herbs
  else if (hasHerbal && !/^(中药调理|方药中药调理|中药|方药)$/.test(pText)) {
    categories.herbalMedicine.push(details);
  }
  // 8. Administrative / Billing logs
  else if (hasBilling) {
    categories.administrativeLog.push(details);
  }
  // 9. Generic placeholders
  else {
    categories.genericPlaceholders.push(details);
  }
}

console.log("--- FINAL METHODS & MACHINES CATEGORIZATION ---");
console.log(`Shockwave Machine (ESWT/SWT): ${categories.shockwaveMachine.length}`);
console.log(`TENS Machine (Electrical Nerve Stimulation): ${categories.tensMachine.length}`);
console.log(`MFR Manual Release: ${categories.mfrManual.length}`);
console.log(`Tuina Manual Therapy: ${categories.tuinaManual.length}`);
console.log(`Acupuncture Needling & Meridian: ${categories.acupunctureNeedle.length}`);
console.log(`Chinese Herbal Prescriptions: ${categories.herbalMedicine.length}`);
console.log(`Combined Multi-Modal Treatments: ${categories.combinedMultiModal.length}`);
console.log(`Generic Placeholders: ${categories.genericPlaceholders.length}`);
console.log(`Administrative & Billing Noise: ${categories.administrativeLog.length}`);

console.log("\n--- EXAMPLES ---");
console.log("\n[SHOCKWAVE MACHINE]");
categories.shockwaveMachine.slice(0, 3).forEach(x => console.log(`- "${x.pText.replace(/\n/g, ' ')}" for ${x.diagnosis}`));

console.log("\n[TENS MACHINE]");
categories.tensMachine.slice(0, 3).forEach(x => console.log(`- "${x.pText.replace(/\n/g, ' ')}" for ${x.diagnosis}`));

console.log("\n[COMBINED MULTI-MODAL]");
categories.combinedMultiModal.slice(0, 4).forEach(x => console.log(`- "${x.pText.replace(/\n/g, ' ')}" for ${x.diagnosis}`));
