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

console.log("Fetching Ardy's consultations to run diagnosis-to-modality mapping...");

const { data, error } = await supabase
  .from("consultations")
  .select("id, form_data")
  .eq("doctor_email", "ardytcm@gmail.com");

if (error) {
  console.error("DB Error:", error.message);
  process.exit(1);
}

console.log(`Analyzing ${data.length} consultations from Ardy.`);

const mapping = {};

const shockwaveRegex = /ESWT|SWT|shockwave/i;
const tuinaRegex = /推拿|Tuina|Acupressure|facial/i;
const acupunctureRegex = /针刺|针灸|刺络|拔罐|艾灸|阿是|穴|肩井|合谷|阳陵泉|曲池/i;
const herbalRegex = /汤|丸|散|饮|膏|二陈|六味|保和|逍遥|止嗽|桂枝|[\u4e00-\u9fa5]+\s*\d+|g\b|x3\b|x1\b/i;

for (const row of data) {
  const form = row.form_data;
  if (!form) continue;

  let diagnosis = (form.diagnosis || "").trim();
  if (!diagnosis || diagnosis === "不适" || diagnosis === "未知" || diagnosis === "未提供") {
    // skip generic vague administrative placeholder diagnoses to focus on clinical reality
    continue;
  }

  // Normalize spelling variations slightly to group matching concepts
  if (diagnosis === "痹症") diagnosis = "痹病";

  const pText = (form.prescription || "").trim();
  if (!pText || pText.includes("ROC Number") || pText.includes("times left") || pText.includes("trt con")) {
    continue;
  }

  // Classify active modalities within the actual text
  const modalities = [];
  if (shockwaveRegex.test(pText)) {
    modalities.push("Hardware Treatment (ESWT/SWT)");
  }
  if (acupunctureRegex.test(pText)) {
    modalities.push("Acupuncture");
  }
  if (tuinaRegex.test(pText)) {
    modalities.push("Tuina");
  }
  
  // Exclude generic placeholder text "中药调理" from active herbal prescription counts to stay realistic
  const isGenericHerbText = /^(中药调理|方药中药调理|中药|方药)$/.test(pText);
  if (herbalRegex.test(pText) && !isGenericHerbText && !pText.includes("ROC")) {
    modalities.push("Chinese Herbal");
  }

  if (modalities.length === 0) {
    // If it's a generic Chinese placeholder but marked as a type, fall back to DB type
    const dbType = form.prescriptionType;
    if (dbType === "针灸") modalities.push("Acupuncture");
    else if (dbType === "方药") modalities.push("Chinese Herbal");
    else if (dbType === "推拿") modalities.push("Tuina");
    else if (dbType === "综合调理") modalities.push("Tuina"); // typical fallback
  }

  if (!mapping[diagnosis]) {
    mapping[diagnosis] = {
      total: 0,
      modalities: {
        "Acupuncture": 0,
        "Chinese Herbal": 0,
        "Tuina": 0,
        "Hardware Treatment (ESWT/SWT)": 0
      }
    };
  }

  mapping[diagnosis].total++;
  for (const mod of modalities) {
    mapping[diagnosis].modalities[mod]++;
  }
}

console.log("--- DIAGNOSIS TO MODALITY MAP ---");
const sortedDiagnoses = Object.entries(mapping)
  .sort((a, b) => b[1].total - a[1].total);

console.log(JSON.stringify(sortedDiagnoses, null, 2));
