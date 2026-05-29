# Historical Clinical Data Ingestion Rules & Planning

This document serves as the canonical reference for ingesting historical clinical records from Odoo/Excel exports into the Supabase database.

---

## 1. Confirmed Ingestion Rules (Locked In)

These data extraction and normalization rules are finalized and will be implemented in the ingestion CLI script:

### A. Age Parsing (`patientAge`)
* **Source:** `Age` column (e.g., `35y 6m 28d`).
* **Rule:** Extract only the leading integer representing years preceding `y` and ignore all months and days.
* **Code Example:** `row.Age.match(/^(\d+)y/)?.[1] || "30"`
* **Pediatric Edge Case:** If the year is `0y` (infant under 1 year), round up to `"1"` to satisfy Zod's `1-120` age range constraints.

### B. Case Identifier (`case_id`)
* **Source:** `Order Ref` column (e.g., `NovaHealth/034511`).
* **Rule:** Extract only the trailing numeric sequence following the slash. This is critical for deduplication and matching related cases.
* **Code Example:** `row["Order Ref"].split("/")[1] || ""` $\rightarrow$ `"034511"`

### C. Missing Mandatory Fields (Fallback)
* **Source:** `Past Medical History 既往史` and `Medical Examination 体格检查` fields.
* **Rule:** Since the new workbench schema makes both fields mandatory, any `null`, `undefined`, empty strings, or `"NA"` in the Excel export will be automatically normalized to **`"无"`**.

---

## 2. Pending Questions & Clarifications for the Doctor

The following clarifications need to be aligned with the doctor to ensure ingestion accuracy:

### A. Patient Gender (`patientSex`)
* **Status:** **Pending Doctor Clarification**
* **The Problem:** The Excel/Odoo export does not contain gender information, but the database requires `patientSex` to be exactly `"男"` or `"女"`.
* **Proposed Solution:** Check if the doctor can provide a patient list with gender. If not, the script will:
  1. Auto-detect using clinical keywords (e.g., `"不孕"`, `"月经"`, `"痛经"`, `"PCOS"` $\rightarrow$ `"女"`; `"阳痿"`, `"遗精"`, `"前列腺"` $\rightarrow$ `"男"`).
  2. Fall back to an interactive CLI prompt to let the operator manually input gender when ambiguous.

### B. Dedicated Columns for Prescription Type & TCM Pattern
* **Status:** **Pending Doctor Clarification**
* **The Problem:** Some of our Excel templates contain separate columns (`处方类型` and `证型`), while other exports merge these into the `Diagnosis 诊断` (e.g., `"膝外侧副韧带炎\n气血瘀滞"`) and `Treatment 治疗描述` cells.
* **Proposed Solution:** Confirm which file format the doctor will provide. If they are merged, our script will:
  * Split `Diagnosis` by newline or comma to extract the diagnosis and pattern.
  * Classify `prescriptionType` by checking the treatment description for keywords (e.g., `"针"` $\rightarrow$ `"针灸"`, `"推拿"` $\rightarrow$ `"综合调理"`, formula numbers $\rightarrow$ `"方药"`).

---

## 3. Prompt Refinement & Noise Elimination Strategy

### A. The Noise Problem
The historical `Treatment 治疗描述` column frequently contains non-clinical metadata, billing notes, and administrative remarks. For example:
```text
龙胆泻肝5 生地1 ...
她的consult每次可以claim $40
所以每次issue consult $40
然后treatment/med就减$10
#不用写药袋！她会自己带
```
If fed raw into the DeepSeek clinical analysis API, these non-clinical remarks act as noise, potentially polluting the AI's clinical review.

### B. Special Handling & Refinement Strategy
To eliminate this noise, we will implement a two-layered defense:

#### Layer 1: Ingestion-Time Preprocessing (CLI Script)
The CLI script will process the raw `Treatment` string and strip out obviously non-clinical administrative lines before inserting them into `form_data.prescription`.
* **Rules to strip out lines:**
  * Lines starting with `#` (standard comment symbol).
  * Lines containing financial symbols or billing terms: `$`, `claim`, `consult`, `price`, `charge`, `payment`.
  * Lines matching patterns of clinic reminders (e.g., `自备药袋`, `不用写药袋`).

#### Layer 2: DeepSeek Prompt Hardening
We will update our DeepSeek analysis system prompts to ignore any remaining administrative or billing text in the `prescription` field.
* **Prompt addition:**
  > "注意：处方中可能包含医生录入的门诊收费备注、患者商业保险理赔信息或纸袋包装等非临床指令（例如：'claim $40', '不用写药袋'）。在进行方药/针灸研判时，请彻底忽略此类非临床噪声，仅对实际的药物组成、剂量及选穴方案进行评估。"
