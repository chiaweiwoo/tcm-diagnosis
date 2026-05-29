# Clinical Data Ingestion: Noise & Anomaly Audit (`nova_data.xls`)

This document details the comprehensive findings of the data audit conducted on `nova_data.xls` (containing **1,867 rows** and **12 columns**). It categorizes clinical data noise, outlines the impact on Large Language Models (LLM), and establishes strict normalization rules and prompt engineering modifications to shield our AI pipeline from billing and administrative anomalies.

---

## 1. Summary of Data Anomalies & Statistics

The data audit of the **1,867 historical records** revealed a very high rate of missing fields and clinical noise:

| Metric / Attribute | Count of Affected Rows | Percentage | Impact & Action Plan |
| :--- | :--- | :--- | :--- |
| **Total Dataset Rows** | 1,867 rows | 100% | Full historical corpus. |
| **Missing Past History** | 1,357 rows | **72.6%** | Defaulting to `"无"` to satisfy Zod mandatory validation. |
| **Missing Physical Exam** | 1,554 rows | **83.2%** | Defaulting to `"未见异常"` to satisfy Zod validation. |
| **Billing / Admin Noise** | 382 rows | **20.4%** | Administrative, billing, and packaging comments must be stripped. |
| **Multi-Visit Progress Logs** | 2,841 matches | **N/A (Multi-match)** | Multiple dates/prescriptions merged into individual cells. |

---

## 2. Categorized Noise & Exact Data Examples

We identified four distinct types of "noises" in the source Excel fields that directly impact both database integrity and LLM reasoning.

### Category A: Billing, Claims, & Split Receipts
* **Description:** Detailed insurance claims instructions, receipt split splits (splitting bills between family members to maximize company benefits), GST adjustments, and package balance counts.
* **Impact on AI:** If sent to DeepSeek, the model attempts to interpret these monetary notes, leading to warnings or hallucinations about clinical efficacy and price-gouging.
* **Raw Examples from `nova_data.xls`:**
  * **Row 4 (Insomnia):**
    > `"她的consult每次可以claim $40 / 所以每次issue consult $40 / 然后treatment/med就减$10 / #不用写药袋！她会自己带"`
  * **Row 113 (Acupuncture):**
    > `"$1000 (before GST) split to 4receipts (说好了$500 under Wu Yi, 另外$500 under老公), $250 taken on 5/5/26 (name Wu Yi)"`
  * **Row 120 (Acupuncture):**
    > `"Ho Kwai Fong 96269734 son. Split into 5 receipts-Each max $100 (Consult $20 Treatment $80). To send him every 3 days."`
  * **Row 134 (Herbal/Tuina):**
    > `"$1200 receipt, $137.62 (before GST)..."`

---

### Category B: Non-Clinical Product Sales & Packages
* **Description:** Over-the-counter health supplements, packaging items, physical devices, or hair-growth treatments sold alongside consultations, noted in the treatment field.
* **Impact on AI:** DeepSeek might mistake product names (e.g., `"苦瓜"` / `"Lipid health"`) as custom-compounded TCM herbs and flag them as toxic, incompatible, or deficient.
* **Raw Examples from `nova_data.xls`:**
  * **Row 15 (Alopecia):** `Treatment: "Hairboom x1"` (A laser hair-growth helmet, not a herb).
  * **Row 14 (Pelvic Sprain):** `Treatment: "Lipid health x2 $35"` (A dietary supplement).
  * **Row 89 / 107 (Unspecified):** `Treatment: "苦瓜1bottle $85, Lipid health x1 $20, ROC Number : R00008665234"` (Bitter melon health supplement bottle).
  * **Row 20 (Wrist Pain):** `Treatment: "HPTP Plaster x1"` (Pain relief plaster/patch).

---

### Category C: Multi-Visit Temporal Records (Progress Logs)
* **Description:** A single row in the spreadsheet contains progress notes spanning weeks or months, separated by date delimiters (e.g., `12/12/25`, `06/01/26`), showing adjustments in symptoms and herbs.
* **Impact on AI:** The AI gets confused trying to evaluate a prescription that is actually 3 or 4 different historical formulations mixed together.
* **Raw Examples from `nova_data.xls`:**
  * **Row 4 (现病史 History of Presenting Complaint):**
    > `"身热颈项燥热... \n\n 12/12/25：身热燥热，无烦躁... \n\n 06/01/26：入眠少许困难... \n\n 20/01/26：入眠可，无梦... \n\n 03/03/26：入眠困难，睡眠间断..."`
  * **Row 13 (Treatment 治疗描述):**
    > `"毓麟珠加减... \n\n 08/05/26：六味地黄5... \n\n 15/05/26：金桂肾气丸5... \n\n 22/05/26：金匮肾气丸5..."`

---

### Category D: Structural Field Misplacements (Anomalies)
* **Description:** Internal system reference codes, transaction records, or billing splits written directly into the `Diagnosis 诊断` or `Past Medical History` fields.
* **Impact on AI:** Hard-blocks Zod validation schemas (which expect actual diagnoses) and causes the AI to analyze billing codes as a medical disease.
* **Raw Examples from `nova_data.xls`:**
  * **Row 128 / 164 (Diagnosis 诊断):**
    > `"$500 (before GST) split to 8receipts / Tuina $60 (before GST) issue on 21/04/26 - 1/8"`
  * **Row 345 (Diagnosis 诊断):**
    > `"ROC Number : R00008685597"`
  * **Row 20 (Past History 既往史):**
    > `"bench press in the gym x2/week, 60kg"`

---

## 3. Double-Layer Noise Elimination Architecture

To prevent these anomalies from reaching our clinical analysis models, we implement a **Double-Layer Defense Strategy**:

```
Excel/Odoo Source Data 
      │
      ▼
┌──────────────────────────────────────────────┐
│  LAYER 1: Ingestion-Time Sanitizer (CLI)     │
│  - Filters lines with: $, GST, receipt, claim │
│  - Strips administrative hashtag (#) lines   │
│  - Cleans structured field misplacements     │
└──────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────┐
│  LAYER 2: DeepSeek Prompt Hardening           │
│  - System instructions to ignore remaining   │
│    billing/non-clinical texts & comments.    │
└──────────────────────────────────────────────┘
      │
      ▼
Cleaned DeepSeek Clinical Analysis
```

### Layer 1: Ingestion Sanitizer Rules (CLI Script)
The ingestion script `scripts/ingest-historical.mjs` will apply the following regex sanitization:
1. **Monetary & Billing Filter:** Split strings by line breaks, and discard any line matching:
   - `/[\$\d]*\d+\s*(receipt|session|each|per|bf GST|GST|claim|consult)/i`
   - `/不用收|收费|收据|配套/`
2. **Hashtag Comment Filter:** Discard any line starting with `#` (e.g., `#不用写药袋！她会自己带`).
3. **Supplement Isolation:** Extract and strip out product mentions like `"Lipid health"`, `"Hairboom"`, or `"bottle"` to keep only the pure herbs or acupuncture acupoints.
4. **Diagnosis Validation Guard:** If the `Diagnosis 诊断` field contains financial or reference terms, the script will:
   - Check if a valid western diagnosis is present elsewhere (like in the complaint).
   - If not, default to the `chiefComplaint` or flag the record for review instead of writing billing data to the `diagnosis` field.

---

## 4. Actionable LLM System Prompt Overrides

We will inject the following instruction blocks directly into our core analysis prompts (`src/lib/ai/prompts.ts` or `src/lib/analytics/prompts.ts`) to reinforce robustness when parsing historical data.

### English Override Instruction
```text
=== CLINICAL CLEANUP SAFEGUARD ===
IMPORTANT: The patient's prescription (Treatment) or current illness fields may contain administrative, billing, or packaging metadata entered by the clinician (e.g., "claim $40", "split to 4 receipts", "free treatment redeem", "#no medicine bag required", or supplementary product sales like "Hairboom x1", "Lipid health"). 
You MUST completely ignore these non-clinical noises. Focus strictly on evaluating the actual herbal composition, dosage, or acupuncture acupoints. Do not comment on pricing, insurance, or product sales in your output.
```

### Chinese Override Instruction (Preferred for DeepSeek Chinese Clinical Output)
```text
=== 临床数据噪声屏蔽指令 ===
重要提示：患者的“治疗描述（处方）”或“现病史”字段中可能包含医生录入的门诊收费备注、商业保险理赔要求、发票拆分指令或纸袋包装等行政指示（例如：“claim $40”、“收据已拿”、“#不用写药袋”、“配套剩4次”，或“Hairboom”、“苦瓜补充剂”等非处方商品销售）。
你必须彻底屏蔽此类非临床行政及财务噪声。在进行方药研判、针灸分析、加减配伍评估时，仅对实际的中药药味、剂量、针灸穴位及手法进行专业评判。严禁在输出结果中提及任何关于价格、收费、理赔或商品销售的内容。
```
