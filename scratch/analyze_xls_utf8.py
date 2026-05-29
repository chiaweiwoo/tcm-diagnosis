import sys
import pandas as pd
import numpy as np

# Reconfigure stdout to handle UTF-8 printing
sys.stdout.reconfigure(encoding='utf-8')

def analyze():
    f1 = r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (1).xls"
    f2 = r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (2).xls"

    df1 = pd.read_excel(f1)
    df2 = pd.read_excel(f2)

    print(f"File 1 (pos.order (1).xls) Shape: {df1.shape}")
    print(f"File 2 (pos.order (2).xls) Shape: {df2.shape}")

    cols1 = set(df1.columns)
    cols2 = set(df2.columns)

    print("\n--- Column Comparison ---")
    print(f"Columns in File 1 but not File 2: {cols1 - cols2}")
    print(f"Columns in File 2 but not File 1: {cols2 - cols1}")
    print(f"Shared Columns: {cols1 & cols2}")

    for name, df in [("pos.order (1).xls", df1), ("pos.order (2).xls", df2)]:
        print(f"\n==========================================")
        print(f"Detailed Analysis of {name}")
        print(f"==========================================")
        for col in df.columns:
            non_null = df[col].count()
            nunique = df[col].nunique()
            is_num = pd.api.types.is_numeric_dtype(df[col])
            print(f"\nColumn: {col}")
            print(f"  Non-null count: {non_null} / {len(df)}")
            print(f"  Unique count: {nunique}")
            
            # If unique count is small, show all of them.
            if nunique <= 30:
                vals = df[col].dropna().unique()
                print(f"  Distinct values: {list(vals)}")
            else:
                if is_num:
                    print(f"  Numeric Range: {df[col].min()} to {df[col].max()} (Mean: {df[col].mean():.2f})")
                else:
                    vals = df[col].dropna().unique()
                    # Just print string lengths or simple stats to save printing large strings
                    print(f"  Sample values (first 3): {list(vals[:3])}")
            
            # Check for date fields
            col_lower = col.lower()
            if 'date' in col_lower or 'time' in col_lower:
                try:
                    parsed_dates = pd.to_datetime(df[col], errors='coerce')
                    valid_dates = parsed_dates.dropna()
                    if len(valid_dates) > 0:
                        print(f"  -> Interpreted as Date. Range: {valid_dates.min()} to {valid_dates.max()}")
                except Exception as e:
                    pass

if __name__ == '__main__':
    analyze()
