import xlrd
import os
import re

def inspect_xls(file_path, report_path):
    print(f"Opening Excel file: {file_path}")
    if not os.path.exists(file_path):
        print("Error: File not found.")
        return
        
    workbook = xlrd.open_workbook(file_path)
    sheet_names = workbook.sheet_names()
    print(f"Sheet names found: {sheet_names}")
    
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"Excel File Analysis: {file_path}\n")
        f.write(f"Sheet names: {sheet_names}\n\n")
        
        for sheet_name in sheet_names:
            sheet = workbook.sheet_by_name(sheet_name)
            f.write("="*80 + "\n")
            f.write(f"SHEET: {sheet_name} ({sheet.nrows} rows, {sheet.ncols} columns)\n")
            f.write("="*80 + "\n")
            
            if sheet.nrows == 0:
                f.write("Empty sheet.\n")
                continue
                
            # Get headers
            headers = [str(sheet.cell_value(0, col)).strip() for col in range(sheet.ncols)]
            f.write(f"Columns: {headers}\n\n")
            
            # Display first 20 data rows for comprehensive review
            f.write("--- FIRST 20 DATA ROWS ---\n")
            for r in range(1, min(21, sheet.nrows)):
                row_vals = [str(sheet.cell_value(r, col)).strip() for col in range(sheet.ncols)]
                row_dict = dict(zip(headers, row_vals))
                f.write(f"Row {r}:\n")
                for k, v in row_dict.items():
                    f.write(f"  {k}: {v}\n")
                f.write("\n")
                
            # Analyze potential noises, billings, multiple visits, and anomalies
            f.write("--- NOISE AND ANOMALY SCAN ---\n")
            billing_patterns = [r'\$', r'claim', r'consult', r'fee', r'price', r'charge', r'payment', r'rmb', r'元', r'收费', r'打折', r'优惠']
            multivisit_patterns = [r'\d{2}/\d{2}/\d{2}', r'\d{4}-\d{2}-\d{2}', r'复诊', r'再诊', r'续服', r'\d{1,2}d', r'\d{1,2}天']
            
            billing_matches = 0
            multivisit_matches = 0
            blank_past_history = 0
            blank_physical_exam = 0
            
            for r in range(1, sheet.nrows):
                for col in range(sheet.ncols):
                    val = str(sheet.cell_value(r, col)).strip()
                    col_name = headers[col]
                    
                    # Scan for billing / non-clinical words
                    for pat in billing_patterns:
                        if re.search(pat, val, re.IGNORECASE):
                            if billing_matches < 30:
                                f.write(f"[Row {r} | Col '{col_name}'] Potential Billing/Admin Noise: '{val[:120]}...'\n")
                            billing_matches += 1
                            break
                            
                    # Scan for multi-visit logs
                    for pat in multivisit_patterns:
                        if re.search(pat, val, re.IGNORECASE):
                            if multivisit_matches < 30:
                                f.write(f"[Row {r} | Col '{col_name}'] Potential Multi-Visit Record: '{val[:120]}...'\n")
                            multivisit_matches += 1
                            break
                    
                    # Scan for missing mandatory fields
                    if "既往" in col_name or "Past" in col_name:
                        if not val or val.lower() in ["", "na", "null", "none", "无"]:
                            blank_past_history += 1
                    if "体格" in col_name or "Exam" in col_name:
                        if not val or val.lower() in ["", "na", "null", "none", "无"]:
                            blank_physical_exam += 1
                            
            f.write(f"\nScan Summary:\n")
            f.write(f"- Total rows containing potential billing/admin noises: {billing_matches}\n")
            f.write(f"- Total rows containing potential multi-visit structures: {multivisit_matches}\n")
            f.write(f"- Rows with empty/null Past History: {blank_past_history}\n")
            f.write(f"- Rows with empty/null Physical Exam: {blank_physical_exam}\n")
            f.write("\n")
            
    print(f"Analysis completed successfully. Written to: {report_path}")

if __name__ == "__main__":
    inspect_xls("nova_data_may.xls", "scratch/xls_may_analysis.txt")
