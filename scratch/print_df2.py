import sys
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

df2 = pd.read_excel(r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (2).xls")
print(df2.to_string())
