import sys
import pandas as pd
import re

sys.stdout.reconfigure(encoding='utf-8')

df1 = pd.read_excel(r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (1).xls")
df2 = pd.read_excel(r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (2).xls")

print("Checking for doctor or dr patterns...")
for name, df in [("File 1", df1), ("File 2", df2)]:
    print(f"\n{name}:")
    for col in df.columns:
        sample_str = df[col].astype(str)
        dr_matches = sample_str[sample_str.str.contains(r'Dr\b|dr\b|医生|医师|consultant|physician|Dr\.', flags=re.IGNORECASE, na=False)]
        if len(dr_matches) > 0:
            print(f"  Found potential doctor/practitioner mentions in '{col}' (total {len(dr_matches)} rows matching):")
            print(dr_matches.value_counts().head(5))
