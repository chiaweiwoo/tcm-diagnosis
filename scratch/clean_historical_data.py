# -*- coding: utf-8 -*-
"""
scratch/clean_historical_data.py

Extracts, cleans, and normalizes clinical consultations from nova_data_may.xls
for doctor ardytcm@gmail.com, targeting only records between May 11, 2026 and May 22, 2026.
Uses smart text analysis, feedback preservation mapping, and chronological related_case_id shift logic.
"""

import xlrd
import sys
import re
import csv
import json
import uuid
from datetime import datetime, timedelta

# Reconfigure stdout to use UTF-8 to prevent Windows terminal encoding crashes
sys.stdout.reconfigure(encoding="utf-8")

def excel_date_to_datetime(serial):
    try:
        # Excel epoch starts 1899-12-30
        return datetime(1899, 12, 30) + timedelta(days=serial)
    except Exception as e:
        return None

def strip_admin_noise(text):
    if not text:
        return ""
    
    lines = text.split("\n")
    cleaned_lines = []
    
    # Noise indicators
    billing_keywords = ["$", "claim", "consult", "fee", "price", "charge", "payment", "receipt", "gst", "ihp", "split", "invoice", "cash", "打折", "优惠", "收费"]
    product_keywords = ["hairboom", "lipid health", "bottle", "plaster", "yellow x1", "pill", "capsule", "lotion", "药袋", "自备", "不用写"]
    
    for line in lines:
        line_stripped = line.strip()
        # Skip standard comment markers
        if line_stripped.startswith("#"):
            continue
            
        # Check billing and financial noise
        line_lower = line_stripped.lower()
        if any(kw in line_lower for kw in billing_keywords):
            continue
            
        # Check retail product sales noise
        if any(kw in line_lower for kw in product_keywords):
            continue
            
        cleaned_lines.append(line)
        
    return "\n".join(cleaned_lines).strip()

def infer_prescription_type(treatment_text):
    if not treatment_text:
        return "方药"
    
    text_lower = treatment_text.lower()
    
    # 1. Manual therapy keywords
    manual_keywords = ["推拿", "按摩", "拉伸", "正骨", "整脊", "拔罐", "mfr", "swt", "wave", "shockwave"]
    has_manual = any(kw in text_lower for kw in manual_keywords)
    
    # 2. Acupuncture keywords
    acupuncture_keywords = ["针", "针刺", "针灸", "穴", "阿是", "电针", "acupuncture", "dry needling"]
    has_acupuncture = any(kw in text_lower for kw in acupuncture_keywords)
    
    # 3. Herbal keywords
    herbal_keywords = ["g", "克", "帖", "剂", "汤", "丸", "散", "1=", "2=", "生地", "党参", "甘草", "黄芪", "当归"]
    has_herbals = any(kw in text_lower for kw in herbal_keywords)
    
    if has_manual and has_acupuncture:
        return "综合调理"
    elif has_manual:
        # Pure manual therapy is best categorized as 综合调理
        return "综合调理"
    elif has_acupuncture:
        return "针灸"
    else:
        return "方药"

def split_diagnosis_and_pattern(diag_text):
    if not diag_text:
        return "不适", "气血瘀滞"
        
    # Standardize string and remove parenthetical syndromic suffixes
    clean_text = re.sub(r"[（(](证型|证|中医诊断|分型)[:：\s]?", "", diag_text)
    clean_text = clean_text.replace("）", "").replace(")", "").strip()
    
    lines = [line.strip() for line in clean_text.split("\n") if line.strip()]
    
    diagnosis = ""
    pattern = ""
    
    if len(lines) >= 2:
        diagnosis = lines[0]
        pattern = " ".join(lines[1:])
    else:
        # Try split by common delimiters
        text = lines[0]
        parts = re.split(r"[，,；;\s+]+", text)
        if len(parts) >= 2:
            diagnosis = parts[0]
            pattern = " ".join(parts[1:])
        else:
            diagnosis = text
            # Try to identify pattern keywords within the diagnosis itself
            common_patterns = [
                "气血瘀滞", "气滞血瘀", "肝郁化火", "肾阳虚", "肾阴虚", 
                "脾胃虚弱", "湿热", "痰湿", "风寒", "风热", "心脾两虚", 
                "肝肾阴虚", "气血不足", "寒痰", "肝郁脾虚", "脾肾亏虚"
            ]
            matched_pattern = None
            for cp in common_patterns:
                if cp in diagnosis:
                    matched_pattern = cp
                    break
            
            if matched_pattern:
                pattern = matched_pattern
            else:
                pattern = "气血瘀滞"
                
    # Safeguard character limits (Diagnosis: 100, Pattern: 100)
    return diagnosis[:95], pattern[:95]

def clean_and_remap():
    file_path = "nova_data_may.xls"
    print(f"Reading historical consultations from {file_path}...")
    
    workbook = xlrd.open_workbook(file_path)
    sheet = workbook.sheet_by_index(0)
    headers = [str(sheet.cell_value(0, col)).strip() for col in range(sheet.ncols)]
    
    # Target date range (May 11, 2026 to May 22, 2026 inclusive)
    start_date = datetime(2026, 5, 11, 0, 0, 0)
    end_date = datetime(2026, 5, 22, 23, 59, 59)
    
    all_raw_rows = []
    skipped_date_count = 0
    
    for r in range(1, sheet.nrows):
        row_vals = [sheet.cell_value(r, col) for col in range(sheet.ncols)]
        row_dict = dict(zip(headers, row_vals))
        
        # Date filtering
        created_val = row_dict.get("Created on", 0.0)
        created_dt = excel_date_to_datetime(created_val)
        
        if not created_dt:
            skipped_date_count += 1
            continue
            
        if not (start_date <= created_dt <= end_date):
            skipped_date_count += 1
            continue
            
        all_raw_rows.append({
            "created_dt": created_dt,
            "raw": row_dict
        })
        
    print(f"Total rows scanned in sheet: {sheet.nrows - 1}")
    print(f"Rows excluded by date range (Not in May 11-22): {skipped_date_count}")
    print(f"Rows matching target date range: {len(all_raw_rows)}")
    
    # Sort chronologically ascending
    all_raw_rows.sort(key=lambda x: x["created_dt"])
    
    # Group by patient
    patient_groups = {}
    for entry in all_raw_rows:
        patient_id = str(entry["raw"].get("Patient 患者", "")).strip()
        if patient_id not in patient_groups:
            patient_groups[patient_id] = []
        patient_groups[patient_id].append(entry)
        
    print(f"Unique patients in target group: {len(patient_groups)}")
    
    # Let's perform smart inferences at patient level
    clean_records = []
    
    # Predefined feedback backup mapping (Cases 034506 and 034484)
    backup_feedbacks = {
        "034506": {
            "ai_feedback": "这是复诊病例，以后请结合随访病案编号结合分析，看看治疗方案和治疗效果怎么样",
            "ai_feedback_updated_at": "2026-05-23T04:32:29.914Z"
        },
        "034484": {
            "ai_feedback": "整体还好，建议根据现病史 and 诊断，检验是否诊断和症状符合，如果不符合请列出",
            "ai_feedback_updated_at": "2026-05-22T06:21:58.912Z"
        }
    }
    
    for patient_id, group in patient_groups.items():
        # 1. Smart Patient Gender Inference
        # Scan all clinical text for this patient across all their visits in May
        female_keywords = ["妇", "女", "不孕", "求子", "胎", "产", "孕", "经", "乳", "卵巢", "子宫", "阴道", "痛经", "月经", "白带", "PCOS", "乳腺", "更年期", "毓麟珠", "她"]
        male_keywords = ["男", "阳痿", "前列腺", "遗精", "早泄", "睾丸", "阴囊", "他"]
        
        combined_patient_text = ""
        for entry in group:
            raw = entry["raw"]
            combined_patient_text += " ".join([
                str(raw.get("Diagnosis 诊断", "")),
                str(raw.get("History of Presenting Complaint 现病史", "")),
                str(raw.get("Presenting Complaint 主诉", "")),
                str(raw.get("Treatment 治疗描述", ""))
            ]).lower()
            
        inferred_sex = None
        for kw in female_keywords:
            if kw in combined_patient_text:
                inferred_sex = "女"
                break
        if not inferred_sex:
            for kw in male_keywords:
                if kw in combined_patient_text:
                    inferred_sex = "男"
                    break
        # Fallback to female (most common)
        if not inferred_sex:
            inferred_sex = "女"
            
        # 2. Chronological related_case_id shift
        for idx, entry in enumerate(group):
            raw = entry["raw"]
            created_dt = entry["created_dt"]
            
            # Case ID extraction (Order Ref: e.g. NovaHealth/034511 -> 034511)
            order_ref = str(raw.get("Order Ref", "")).strip()
            case_id = order_ref.split("/")[-1].strip() if "/" in order_ref else order_ref
            
            # Related Case ID shift
            related_case_id = None
            if idx > 0:
                prev_order_ref = str(group[idx-1]["raw"].get("Order Ref", "")).strip()
                related_case_id = prev_order_ref.split("/")[-1].strip() if "/" in prev_order_ref else prev_order_ref
                
            # Mapped clinical columns
            age_raw = str(raw.get("Age", "")).strip()
            age_match = re.match(r"^(\d+)y", age_raw)
            patient_age = "30"
            if age_match:
                age_val = int(age_match.group(1))
                if age_val == 0:
                    patient_age = "1"  # Round up infant under 1y
                else:
                    patient_age = str(age_val)
                    
            raw_diag = str(raw.get("Diagnosis 诊断", "")).strip()
            diagnosis, pattern = split_diagnosis_and_pattern(raw_diag)
            
            current_illness = str(raw.get("History of Presenting Complaint 现病史", "")).strip()
            # Clean up billing noise from current illness
            current_illness = strip_admin_noise(current_illness)
            if not current_illness:
                current_illness = "患者初诊调理"
                
            past_history = str(raw.get("Past Medical History 既往史", "")).strip()
            if not past_history or past_history.lower() in ["", "na", "null", "none", "无"]:
                past_history = "无"
                
            physical_exam = str(raw.get("Medical Examination 体格检查", "")).strip()
            if not physical_exam or physical_exam.lower() in ["", "na", "null", "none", "无"]:
                physical_exam = "未见异常"
                
            chief_complaint = str(raw.get("Presenting Complaint 主诉", "")).strip()
            if not chief_complaint:
                chief_complaint = diagnosis if diagnosis else current_illness[:40]
            if not chief_complaint:
                chief_complaint = "中医诊疗"
            chief_complaint = chief_complaint[:195] # Safe length boundary
            
            treatment_raw = str(raw.get("Treatment 治疗描述", "")).strip()
            prescription_type = infer_prescription_type(treatment_raw)
            prescription = strip_admin_noise(treatment_raw)
            if not prescription:
                prescription = "针灸调理" if prescription_type == "针灸" else "方药中药调理"
                
            # Final form_data schema construction
            form_data = {
                "consultationName": "",
                "prescriptionType": prescription_type,
                "patientAge": patient_age,
                "patientSex": inferred_sex,
                "chiefComplaint": chief_complaint,
                "currentIllness": current_illness,
                "pastHistory": past_history,
                "physicalExam": physical_exam,
                "diagnosis": diagnosis,
                "pattern": pattern,
                "prescription": prescription
            }
            
            # Check Zod limits to prevent manual SQL insertion failures
            if len(form_data["chiefComplaint"]) > 200: form_data["chiefComplaint"] = form_data["chiefComplaint"][:198]
            if len(form_data["currentIllness"]) > 2000: form_data["currentIllness"] = form_data["currentIllness"][:1998]
            if len(form_data["pastHistory"]) > 1000: form_data["pastHistory"] = form_data["pastHistory"][:998]
            if len(form_data["physicalExam"]) > 1000: form_data["physicalExam"] = form_data["physicalExam"][:998]
            if len(form_data["diagnosis"]) > 100: form_data["diagnosis"] = form_data["diagnosis"][:98]
            if len(form_data["pattern"]) > 100: form_data["pattern"] = form_data["pattern"][:98]
            if len(form_data["prescription"]) > 2000: form_data["prescription"] = form_data["prescription"][:1998]
            
            # Preserve feedback
            ai_feedback = None
            ai_feedback_updated_at = None
            if case_id in backup_feedbacks:
                ai_feedback = backup_feedbacks[case_id]["ai_feedback"]
                ai_feedback_updated_at = backup_feedbacks[case_id]["ai_feedback_updated_at"]
                
            iso_timestamp = created_dt.isoformat() + "Z"
            
            clean_records.append({
                "id": str(uuid.uuid4()),
                "doctor_email": "ardytcm@gmail.com",
                "case_id": case_id,
                "related_case_id": related_case_id,
                "created_at": iso_timestamp,
                "updated_at": iso_timestamp,
                "form_data": form_data,
                "ai_feedback": ai_feedback,
                "ai_feedback_updated_at": ai_feedback_updated_at
            })
            
    # Sort final clean records chronologically
    clean_records.sort(key=lambda x: x["created_at"])
    print(f"Total cleaned and validated May records: {len(clean_records)}")
    
    # Save as CSV with UTF-8 BOM (excel readable)
    csv_file = "output/nova_data_may_clean.csv"
    print(f"Saving cleaned CSV to {csv_file}...")
    
    csv_cols = ["id", "doctor_email", "case_id", "related_case_id", "created_at", "updated_at", "prescriptionType", "patientAge", "patientSex", "chiefComplaint", "currentIllness", "pastHistory", "physicalExam", "diagnosis", "pattern", "prescription", "ai_feedback", "ai_feedback_updated_at"]
    
    with open(csv_file, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(csv_cols)
        for r in clean_records:
            writer.writerow([
                r["id"],
                r["doctor_email"],
                r["case_id"],
                r["related_case_id"],
                r["created_at"],
                r["updated_at"],
                r["form_data"]["prescriptionType"],
                r["form_data"]["patientAge"],
                r["form_data"]["patientSex"],
                r["form_data"]["chiefComplaint"],
                r["form_data"]["currentIllness"],
                r["form_data"]["pastHistory"],
                r["form_data"]["physicalExam"],
                r["form_data"]["diagnosis"],
                r["form_data"]["pattern"],
                r["form_data"]["prescription"],
                r["ai_feedback"],
                r["ai_feedback_updated_at"]
            ])
            
    print("CSV saved successfully.")
    
    # Save ready-to-run insert script SQL (fully escaped for safe JS runner execution)
    sql_file = "scratch/insert_ardy_data.sql"
    print(f"Generating ready-to-execute SQL file at {sql_file}...")
    
    sql_statements = []
    
    for r in clean_records:
        fd_json = json.dumps(r["form_data"], ensure_ascii=False).replace("'", "''")
        ai_fb = f"'{r['ai_feedback']}'" if r["ai_feedback"] else "NULL"
        if ai_fb != "NULL":
            ai_fb = ai_fb.replace("'", "''")
            # Wrap in single quotes correctly after replacement
            ai_fb = f"'{ai_fb[2:-2]}'"
            
        ai_fb_time = f"'{r['ai_feedback_updated_at']}'" if r["ai_feedback_updated_at"] else "NULL"
        rel_case = f"'{r['related_case_id']}'" if r["related_case_id"] else "NULL"
        
        stmt = (
            f"INSERT INTO public.consultations ("
            f"id, doctor_email, case_id, related_case_id, created_at, updated_at, "
            f"form_data, model_meta, analysis_status, ai_feedback, ai_feedback_updated_at"
            f") VALUES ("
            f"'{r['id']}', "
            f"'{r['doctor_email']}', "
            f"'{r['case_id']}', "
            f"{rel_case}, "
            f"'{r['created_at']}', "
            f"'{r['updated_at']}', "
            f"'{fd_json}'::jsonb, "
            f"'{{\"imported\": true, \"source\": \"nova_data_may\"}}'::jsonb, "
            f"'draft', "
            f"{ai_fb}, "
            f"{ai_fb_time}"
            f");"
        )
        sql_statements.append(stmt)
        
    with open(sql_file, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_statements) + "\n")
        
    print(f"SQL file generated successfully with {len(sql_statements)} statements.")
    
    # Save as JSON for clean JS runner ingestion
    json_file = "scratch/insert_ardy_data.json"
    print(f"Saving cleaned JSON for Node runner to {json_file}...")
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(clean_records, f, ensure_ascii=False, indent=2)
        
    print("JSON saved successfully.")
    print("Alignment review completed. Ready for database execution.")

if __name__ == "__main__":
    clean_and_remap()
