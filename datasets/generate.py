"""Build the messy baseline CSV, its answer key, and every drift version.

Source: NSW FuelCheck price history, September 2026 (Data.NSW, CC BY-SA).
Everything is seeded, so the same command always produces the same files.

Usage:
    python datasets/generate.py            # writes everything into datasets/
"""
import json
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 2026
SAMPLE_ROWS = 2500
FUELS = ["E10", "U91", "P95", "P98", "DL"]
DATE_FMT = "%d/%m/%Y %H:%M:%S"  # Australian day-first, same as the source
PRICE_MIN, PRICE_MAX = 100, 400  # plausible cents per litre for these fuels
FUEL_NAMES = {"E10": "Ethanol 94", "U91": "Unleaded 91", "P95": "Premium 95",
              "P98": "Premium 98", "DL": "Diesel"}

SOURCE_URL = (
    "https://data.nsw.gov.au/data/dataset/a97a46fc-2bdd-4b90-ac7f-0cb1e8d7ac3b/resource/"
    "bb8f9fe7-17ab-4354-984f-d18dccfd8dcf/download/fuelcheck_pricehistory_sep2026.xlsx"
)

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw" / "fuelcheck_pricehistory_sep2026.xlsx"
XLSX = HERE / "xlsx"


def load_source() -> pd.DataFrame:
    if not RAW.exists():
        RAW.parent.mkdir(exist_ok=True)
        urllib.request.urlretrieve(SOURCE_URL, RAW)
    # First 3 rows are report metadata. Postcode is text in the workbook; keep it that way.
    df = pd.read_excel(RAW, header=3, dtype={"Postcode": str})
    df = df[df.FuelCode.isin(FUELS)]
    return df.sample(SAMPLE_ROWS, random_state=SEED).sort_values("PriceUpdatedDate").reset_index(drop=True)


def clean_form(df: pd.DataFrame) -> pd.DataFrame:
    """What the cleaned output should look like (the answer key's formatting)."""
    out = df.copy()
    for col in ["ServiceStationName", "Address", "Suburb", "Brand"]:
        out[col] = out[col].str.split().str.join(" ")  # single spaces, no padding
    out["Suburb"] = out.Suburb.str.title()
    out["PriceUpdatedDate"] = out.PriceUpdatedDate.dt.strftime(DATE_FMT)
    return out


def inject_mess(clean: pd.DataFrame, raw_suburbs: pd.Series, rng: np.random.Generator):
    """Break a known set of rows. Returns the messy frame, the answer key and a manifest."""
    messy = clean.copy()
    messy["Suburb"] = raw_suburbs  # the source's own mix of ALL CAPS and Title Case
    messy = messy.astype(object)
    manifest = {}
    taken = set()

    def pick(name, frac):
        pool = [i for i in messy.index if i not in taken]
        rows = sorted(rng.choice(pool, size=max(1, round(len(messy) * frac)), replace=False).tolist())
        taken.update(rows)
        manifest[name] = rows
        return rows

    # Real rows that already break the price rule (e.g. a P95 logged at 94 c/L).
    price = pd.to_numeric(clean.Price)
    manifest["real_price_out_of_range"] = clean.index[(price < PRICE_MIN) | (price > PRICE_MAX)].tolist()
    taken.update(manifest["real_price_out_of_range"])

    # Formatting problems: the row survives cleaning once fixed.
    for i in pick("brand_case_whitespace", 0.02):
        messy.at[i, "Brand"] = f"  {str(messy.at[i, 'Brand']).upper()} "
    for i in pick("fuelcode_lowercase", 0.015):
        messy.at[i, "FuelCode"] = str(messy.at[i, "FuelCode"]).lower()
    for i in pick("fuelcode_full_name", 0.012):
        messy.at[i, "FuelCode"] = FUEL_NAMES[messy.at[i, "FuelCode"]]
    for i in pick("price_with_unit", 0.015):
        messy.at[i, "Price"] = f"{messy.at[i, 'Price']}c"
    for i in pick("postcode_excel_float", 0.012):
        messy.at[i, "Postcode"] = f"{messy.at[i, 'Postcode']}.0"
    for i in pick("date_iso_format", 0.015):
        d = pd.to_datetime(messy.at[i, "PriceUpdatedDate"], format=DATE_FMT)
        messy.at[i, "PriceUpdatedDate"] = d.strftime("%Y-%m-%d %H:%M:%S")
    for i in pick("station_double_space", 0.01):
        messy.at[i, "ServiceStationName"] = str(messy.at[i, "ServiceStationName"]).replace(" ", "  ", 1)

    # Invalid or missing values: the row should be dropped.
    for i in pick("missing_price", 0.01):
        messy.at[i, "Price"] = None
    for i in pick("missing_fuelcode", 0.005):
        messy.at[i, "FuelCode"] = None
    for i in pick("price_not_positive", 0.006):
        messy.at[i, "Price"] = rng.choice([0, -float(messy.at[i, "Price"])])
    for i in pick("price_not_a_number", 0.004):
        messy.at[i, "Price"] = "N/A"
    for i in pick("price_decimal_slip", 0.006):
        messy.at[i, "Price"] = round(float(messy.at[i, "Price"]) * rng.choice([10, 0.1]), 2)
    for i in pick("bad_postcode", 0.005):
        messy.at[i, "Postcode"] = rng.choice(["999", "20O0", "29999"])
    for i in pick("unknown_fuelcode", 0.004):
        messy.at[i, "FuelCode"] = "XYZ"

    dropped = [i for k in ("real_price_out_of_range", "missing_price", "missing_fuelcode",
                           "price_not_positive", "price_not_a_number", "price_decimal_slip",
                           "bad_postcode", "unknown_fuelcode")
               for i in manifest[k]]
    expected = clean.drop(index=dropped)

    # Exact duplicates, and near-duplicates that only match once cleaned.
    extra = [messy.loc[pick("duplicated_rows", 0.03)]]
    near = messy.loc[pick("near_duplicate_rows", 0.015)].copy()
    near["Brand"] = near.Brand.str.upper()
    near["Suburb"] = near.Suburb.str.lower() + " "
    extra.append(near)
    messy = pd.concat([messy, *extra]).sample(frac=1, random_state=SEED)
    return messy.reset_index(drop=True), expected.reset_index(drop=True), manifest


# --- drift -----------------------------------------------------------------
# Each takes the messy baseline (and the source dates) and returns a new frame.

def drop_column(df, _):
    return df.drop(columns=["Brand"])


def rename_column(df, _):
    return df.rename(columns={"Price": "PriceCentsPerLitre"})


def change_type(df, _):
    out = df.copy()
    out["Postcode"] = "NSW " + out.Postcode.astype(str)  # number -> text
    return out


def add_column(df, rng):
    out = df.copy()
    out.insert(out.columns.get_loc("FuelCode") + 1, "IsDiscounted", rng.choice(["Y", "N"], len(out)))
    return out


def combined(df, rng):
    return add_column(change_type(rename_column(drop_column(df, rng), rng), rng), rng)


def cents_to_dollars(df, _):
    out = df.copy()
    num = pd.to_numeric(out.Price, errors="coerce")
    out["Price"] = (num / 100).round(3).where(num.notna(), out.Price)  # leave broken cells broken
    return out


def day_month_swap(df, _):
    out = df.copy()
    parsed = pd.to_datetime(out.PriceUpdatedDate, format=DATE_FMT, errors="coerce")
    iso = pd.to_datetime(out.PriceUpdatedDate, format="%Y-%m-%d %H:%M:%S", errors="coerce")
    out["PriceUpdatedDate"] = parsed.fillna(iso).dt.strftime("%m/%d/%Y %H:%M:%S")
    return out


DRIFTS = {
    "schema-drift1-drop-column": drop_column,
    "schema-drift2-rename-column": rename_column,
    "schema-drift3-change-type": change_type,
    "schema-drift4-add-column": add_column,
    "schema-drift5-combined": combined,
    "semantic-drift1-cents-to-dollars": cents_to_dollars,
    "semantic-drift2-date-mmdd": day_month_swap,
}


def write_input(df: pd.DataFrame, name: str) -> None:
    """Write the CSV, plus an .xlsx copy for Rhombus's "From Web URL" importer.

    The .xlsx is built from the CSV's own text with every cell stored as a string,
    so Excel can't "fix" anything (2174.0, 201.9c, ISO dates all survive as written).
    """
    csv_path = HERE / f"{name}.csv"
    df.to_csv(csv_path, index=False)
    text = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    XLSX.mkdir(exist_ok=True)
    text.to_excel(XLSX / f"{name}.xlsx", index=False)


def main() -> None:
    rng = np.random.default_rng(SEED)
    source = load_source()
    clean = clean_form(source)
    messy, expected, manifest = inject_mess(clean, source.Suburb, rng)

    write_input(messy, "baseline")
    expected.to_csv(HERE / "baseline_expected.csv", index=False)
    (HERE / "baseline_manifest.json").write_text(json.dumps(
        {"seed": SEED, "source": SOURCE_URL, "rows_in": len(messy), "rows_expected": len(expected),
         "broken_rows": manifest}, indent=2))

    for name, fn in DRIFTS.items():
        write_input(fn(messy, np.random.default_rng(SEED)), name)

    print(f"baseline.csv: {len(messy)} rows -> expected {len(expected)} after cleaning")
    print(f"drift files: {', '.join(DRIFTS)}")


if __name__ == "__main__":
    main()
