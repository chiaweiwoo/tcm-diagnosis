import pandas as pd
import sys

def analyze_file(filepath):
    print(f"=== Analyzing {filepath} ===")
    try:
        # xls files might need xlrd. Let's see if we can read it.
        # If xlrd is not installed, we can try to install it or use another engine
        df = pd.read_excel(filepath)
        print(f"Shape: {df.shape}")
        print("Columns:")
        for col in df.columns:
            non_null = df[col].count()
            nunique = df[col].nunique()
            dtype = df[col].dtype
            print(f"  - {col} ({dtype}): {non_null} non-null, {nunique} unique values")
            
            # Print distinct values or range if they are low unique count, or if they are relevant
            col_lower = col.lower()
            if nunique <= 20 or any(k in col_lower for k in ['date', 'time', 'user', 'doctor', 'dr', 'saleperson', 'person', 'responsible', 'state', 'status']):
                print(f"    Sample/Unique values: {df[col].dropna().unique()[:20]}")
                if 'date' in col_lower or 'time' in col_lower:
                    try:
                        parsed_dates = pd.to_datetime(df[col], errors='coerce')
                        print(f"    Date Range: {parsed_dates.min()} to {parsed_dates.max()}")
                    except Exception as e:
                        pass
    except Exception as e:
        print(f"Error reading {filepath}: {e}")

if __name__ == '__main__':
    analyze_file(r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (1).xls")
    analyze_file(r"C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\pos.order (2).xls")
