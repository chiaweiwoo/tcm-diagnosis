import pandas as pd
f1 = r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (1).xls"
f2 = r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (2).xls"

xl1 = pd.ExcelFile(f1)
xl2 = pd.ExcelFile(f2)
print("File 1 Sheets:", xl1.sheet_names)
print("File 2 Sheets:", xl2.sheet_names)
