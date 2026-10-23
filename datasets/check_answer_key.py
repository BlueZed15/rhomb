"""Apply the cleaning rules in datasets/README.md to baseline.csv and compare with the answer key.

This is a plain reference implementation of the rules, so anyone can check that
baseline_expected.csv really is what "correctly cleaned" means.

Usage:
    python datasets/check_answer_key.py
"""
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
FUELS = {"E10", "U91", "P95", "P98", "DL"}
FUEL_NAMES = {"ETHANOL 94": "E10", "UNLEADED 91": "U91", "PREMIUM 95": "P95",
              "PREMIUM 98": "P98", "DIESEL": "DL"}
DATE_FMT = "%d/%m/%Y %H:%M:%S"


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in df.columns:                                              # 1. whitespace
        df[col] = df[col].str.split().str.join(" ")
    df = df.dropna(subset=["Price", "FuelCode"])                        # 2. required values
    fuel = df.FuelCode.str.upper()                                      # 3. fuel codes
    df["FuelCode"] = fuel.map(FUEL_NAMES).fillna(fuel)
    df = df[df.FuelCode.isin(FUELS)]
    def spelling(s):  # prefer a non-ALL-CAPS spelling if one exists (BP stays BP)
        normal = s[s != s.str.upper()]
        return (normal if len(normal) else s).value_counts().idxmax()
    canon = df.Brand.groupby(df.Brand.str.lower()).agg(spelling)
    df["Brand"] = df.Brand.str.lower().map(canon)                       # 4. brand casing
    df["Suburb"] = df.Suburb.str.title()                                # 5. suburb casing
    df["Postcode"] = df.Postcode.str.replace(r"\.0$", "", regex=True)   # 6. postcode
    df = df[df.Postcode.str.fullmatch(r"\d{4}")]
    df["Price"] = pd.to_numeric(df.Price.str.rstrip("c"), errors="coerce")  # 7. price
    df = df[df.Price.between(100, 400)]
    dayfirst = pd.to_datetime(df.PriceUpdatedDate, format=DATE_FMT, errors="coerce")  # 8. dates
    iso = pd.to_datetime(df.PriceUpdatedDate, format="%Y-%m-%d %H:%M:%S", errors="coerce")
    df["PriceUpdatedDate"] = dayfirst.fillna(iso).dt.strftime(DATE_FMT)
    return df.drop_duplicates()                                         # 9. duplicates, last


def main() -> None:
    got = clean(pd.read_csv(HERE / "baseline.csv", dtype=str))
    want = pd.read_csv(HERE / "baseline_expected.csv", dtype=str)
    want["Price"] = want.Price.astype(float)
    cols = list(want.columns)
    got = got[cols].sort_values(cols).reset_index(drop=True)
    want = want.sort_values(cols).reset_index(drop=True)
    print(f"cleaned {len(got)} rows, answer key has {len(want)}: {'MATCH' if got.equals(want) else 'DIFFERENT'}")
    if not got.equals(want):
        diff = want.merge(got, how="outer", indicator=True)
        print(diff[diff._merge != "both"].head(10).to_string())


if __name__ == "__main__":
    main()
