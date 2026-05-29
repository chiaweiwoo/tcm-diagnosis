import xlrd
import sys
from datetime import datetime, timedelta

# Reconfigure stdout to use UTF-8 to prevent Windows terminal encoding crashes
sys.stdout.reconfigure(encoding="utf-8")

def excel_date_to_iso(serial):
    try:
        # Excel's epoch is 1899-12-30
        dt = datetime(1899, 12, 30) + timedelta(days=serial)
        return dt.isoformat() + "Z"
    except Exception as e:
        return None

def study_cases():
    file_path = "nova_data_may.xls"
    print(f"Reading {file_path}...")
    workbook = xlrd.open_workbook(file_path)
    sheet = workbook.sheet_by_index(0)
    
    headers = [str(sheet.cell_value(0, col)).strip() for col in range(sheet.ncols)]
    print(f"Headers: {headers}")
    
    rows = []
    for r in range(1, sheet.nrows):
        row_vals = [sheet.cell_value(r, col) for col in range(sheet.ncols)]
        row_dict = dict(zip(headers, row_vals))
        
        # Parse fields for linking
        patient = str(row_dict.get("Patient 患者", "")).strip()
        order_ref = str(row_dict.get("Order Ref", "")).strip()
        created_val = row_dict.get("Created on", 0.0)
        
        # Extract case_id from Order Ref (e.g., "NovaHealth/034511" -> "034511")
        case_id = ""
        if "/" in order_ref:
            case_id = order_ref.split("/")[-1].strip()
        else:
            case_id = order_ref
            
        # Convert created_val (Excel float) to datetime
        created_dt = None
        if isinstance(created_val, (int, float)):
            try:
                created_dt = datetime(1899, 12, 30) + timedelta(days=created_val)
            except:
                pass
        
        rows.append({
            "row_idx": r,
            "patient": patient,
            "order_ref": order_ref,
            "case_id": case_id,
            "created_dt": created_dt,
            "raw_row": row_dict
        })
        
    # Sort chronologically ascending
    rows.sort(key=lambda x: x["created_dt"] if x["created_dt"] is not None else datetime.min)
    
    # Group by patient
    patient_groups = {}
    for row in rows:
        p = row["patient"]
        if p not in patient_groups:
            patient_groups[p] = []
        patient_groups[p].append(row)
        
    # Apply shift logic to assign related_case_id
    linked_count = 0
    singletons = 0
    chains = 0
    
    for p, group in patient_groups.items():
        # group is sorted chronologically ascending
        if len(group) == 1:
            singletons += 1
            group[0]["related_case_id"] = None
        else:
            chains += 1
            for i in range(len(group)):
                if i == 0:
                    group[i]["related_case_id"] = None
                else:
                    group[i]["related_case_id"] = group[i-1]["case_id"]
                    linked_count += 1
                    
    print("\n--- LINKING STATISTICS ---")
    print(f"Total Rows: {len(rows)}")
    print(f"Unique Patients: {len(patient_groups)}")
    print(f"Patients with 1 visit only: {singletons}")
    print(f"Patients with multiple visits: {chains}")
    print(f"Total linked consultations (related_case_id populated): {linked_count}")
    
    # Print some samples of multi-visit patients
    print("\n--- SAMPLE VISIT CHAINS ---")
    printed_chains = 0
    for p, group in patient_groups.items():
        if len(group) >= 3 and printed_chains < 3:
            print(f"\nPatient: {p}")
            for idx, r in enumerate(group):
                iso_time = r["created_dt"].strftime("%Y-%m-%d %H:%M:%S") if r["created_dt"] else "N/A"
                print(f"  Visit {idx+1}: Case ID = {r['case_id']}, Created = {iso_time}, Related Case ID = {r['related_case_id']}")
            printed_chains += 1

if __name__ == "__main__":
    study_cases()
