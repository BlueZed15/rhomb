"""Compare a pipeline's output with the input it was given, and report the differences.

Give it the input file (what went to S3) and the output file (what came back from GCS). It works out what
the output *should* be by applying the same 9 cleaning rules the AI builder was given
(datasets/check_answer_key.py), then compares. Semantic checks look at the output on its own, because a
semantic drift (e.g. prices in dollars) can pass every rule.

Usage:
    python data-validation/validate.py datasets/baseline.csv  data-validation/downloads/output_baseline.csv
    python data-validation/validate.py datasets/xlsx/semantic-drift1-cents-to-dollars.xlsx  output.csv
    python data-validation/validate.py datasets/schema-drift1-drop-column.csv --no-output      # the run wrote nothing

Prints a readable report and saves the full result as JSON in data-validation/results/<name>.json
(--name sets it; by default it's the output file's name).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "datasets"))
from check_answer_key import clean  # noqa: E402  the same rules the AI builder was given

BASELINE_COLS = ["ServiceStationName", "Address", "Suburb", "Postcode", "Brand",
                 "FuelCode", "PriceUpdatedDate", "Price"]
PRICE_BANDS = {"E10": (150, 300), "U91": (150, 300), "P95": (170, 320), "P98": (170, 330), "DL": (180, 340)}
DATE_FMT = "%d/%m/%Y %H:%M:%S"
SOURCE_MONTH = 9  # every source row is from September 2026


def read_table(path: Path) -> pd.DataFrame:
    """Read CSV or XLSX as text, so nothing gets re-typed (postcodes, prices with a 'c', dates)."""
    if path.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(path, dtype=str).fillna("")
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def expected_from(inp: pd.DataFrame):
    try:
        return clean(inp.replace("", pd.NA)), None
    except Exception as exc:  # a drifted schema the rules can't handle (e.g. a missing column)
        return None, f"the cleaning rules can't run on this input ({type(exc).__name__}: {exc})"


def semantic_checks(out: pd.DataFrame) -> dict:
    res = {}
    if "Price" in out.columns and "FuelCode" in out.columns:
        price = pd.to_numeric(out.Price, errors="coerce")
        lo = out.FuelCode.map(lambda f: PRICE_BANDS.get(f, (0, 1e9))[0])
        hi = out.FuelCode.map(lambda f: PRICE_BANDS.get(f, (0, 1e9))[1])
        res["price_outside_fuel_band"] = int(((price < lo) | (price > hi)).sum())
        res["price_median"] = None if price.dropna().empty else float(price.median())
    if "PriceUpdatedDate" in out.columns:
        d = pd.to_datetime(out.PriceUpdatedDate, format=DATE_FMT, errors="coerce")
        res["dates_unparseable_as_ddmm"] = int(d.isna().sum())
        res["dates_outside_source_month"] = int((d.notna() & (d.dt.month != SOURCE_MONTH)).sum())
    if {"ServiceStationName", "FuelCode", "Price", "PriceUpdatedDate"} <= set(out.columns):
        d = pd.to_datetime(out.PriceUpdatedDate, format=DATE_FMT, errors="coerce").dt.date
        p = out.assign(_d=d, _p=pd.to_numeric(out.Price, errors="coerce"))
        piv = p.pivot_table(index=["ServiceStationName", "_d"], columns="FuelCode", values="_p", aggfunc="min")
        bad = 0
        for a, b in [("E10", "U91"), ("U91", "P98")]:
            if a in piv and b in piv:
                bad += int((piv[a] > piv[b]).sum())
        res["fuel_order_violations"] = bad  # same station, same day: E10 <= U91 <= P98
    return res


def compare(inp: pd.DataFrame, out, show: int) -> dict:
    exp, exp_err = expected_from(inp)
    r = {
        "input_rows": len(inp),
        "input_columns": list(inp.columns),
        "schema_vs_baseline": {"missing": [c for c in BASELINE_COLS if c not in inp.columns],
                               "extra": [c for c in inp.columns if c not in BASELINE_COLS]},
        "expected_rows": None if exp is None else len(exp),
        "expected_note": exp_err,
    }
    if out is None:
        r["output"] = None
        return r

    r["output_rows"] = len(out)
    r["output_columns"] = list(out.columns)
    r["output_sha256"] = hashlib.sha256(out.sort_values(list(out.columns)).to_csv(index=False).encode()).hexdigest()[:16]
    r["duplicate_rows"] = int(out.duplicated().sum())
    if exp is not None and list(exp.columns) == list(out.columns):
        e, o = exp.astype(str).copy(), out.copy()
        if "Price" in e:  # 261.9 and 261.90 are the same price
            e["Price"] = pd.to_numeric(e.Price).map(lambda v: f"{v:.1f}")
            o["Price"] = pd.to_numeric(o.Price, errors="coerce").map(lambda v: f"{v:.1f}")
        m = e.merge(o, how="outer", indicator=True)
        r["rows_matching_expected"] = int((m._merge == "both").sum())
        r["rows_missing_from_output"] = int((m._merge == "left_only").sum())
        r["rows_unexpected_in_output"] = int((m._merge == "right_only").sum())
        r["examples_missing"] = m[m._merge == "left_only"].drop(columns="_merge").head(show).to_dict("records")
        r["examples_unexpected"] = m[m._merge == "right_only"].drop(columns="_merge").head(show).to_dict("records")
    elif exp is not None:
        r["columns_differ_from_expected"] = {"expected": list(exp.columns), "output": list(out.columns)}
    r["semantic"] = semantic_checks(out)
    return r


def verdict(r: dict) -> list:
    """Every reason the output isn't what the rules should produce. Empty list = PASS."""
    why = []
    sch = r["schema_vs_baseline"]
    if sch["missing"] or sch["extra"]:
        parts = [f"{c} removed" for c in sch["missing"]] + [f"{c} added" for c in sch["extra"]]
        why.append("input columns changed: " + ", ".join(parts))
    if r.get("output") is None and "output_rows" not in r:
        why.append("no output was written")
        return why
    if r["output_rows"] == 0:
        why.append("the output has 0 rows")
    if r["expected_rows"] is not None and r["output_rows"] != r["expected_rows"]:
        why.append(f"{r['output_rows']} rows out, {r['expected_rows']} expected")
    if "columns_differ_from_expected" in r:
        why.append("output columns differ from the expected columns")
    if r.get("rows_missing_from_output"):
        why.append(f"{r['rows_missing_from_output']} expected rows are missing or different")
    if r.get("rows_unexpected_in_output"):
        why.append(f"{r['rows_unexpected_in_output']} output rows aren't in the expected output")
    for k, v in r.get("semantic", {}).items():
        if k != "price_median" and v:
            why.append(f"semantic check {k.replace('_', ' ')}: {v}")
    if r["duplicate_rows"]:
        why.append(f"{r['duplicate_rows']} duplicate rows")
    return why


def print_report(name: str, r: dict) -> None:
    print(f"\n{name}")
    print(f"  input     {r['input_rows']} rows, {len(r['input_columns'])} columns")
    s = r["schema_vs_baseline"]
    if s["missing"] or s["extra"]:
        print("            columns vs baseline: " + ", ".join([f"{c} removed" for c in s["missing"]] + [f"{c} added" for c in s["extra"]]))
    print(f"  expected  {r['expected_rows'] if r['expected_rows'] is not None else '-'} rows"
          + (f"  ({r['expected_note']})" if r["expected_note"] else ""))
    if "output_rows" not in r:
        print("  output    none")
    else:
        print(f"  output    {r['output_rows']} rows, content sha256 {r['output_sha256']} (rows sorted, so order doesn't matter)")
        if "rows_matching_expected" in r:
            print(f"  rows      {r['rows_matching_expected']} match, {r['rows_missing_from_output']} missing or different"
                  f", {r['rows_unexpected_in_output']} unexpected")
            for label, key in (("missing", "examples_missing"), ("unexpected", "examples_unexpected")):
                for row in r[key][:3]:
                    print(f"     {label:10} {' | '.join(str(v) for v in row.values())}")
        flags = {k: v for k, v in r["semantic"].items() if v and k != "price_median"}
        print(f"  semantic  {flags if flags else 'no flags'}" + (f"  (median price {r['semantic'].get('price_median')})" if r["semantic"].get("price_median") else ""))
    print(f"\n  {r['verdict']}" + "".join(f"\n   - {w}" for w in r["reasons"]))


def main() -> None:
    ap = argparse.ArgumentParser(description="Compare a pipeline output with its input.")
    ap.add_argument("input", type=Path, help="the file the pipeline read (.csv or .xlsx)")
    ap.add_argument("output", type=Path, nargs="?", help="the file the pipeline wrote (.csv)")
    ap.add_argument("--no-output", action="store_true", help="the run wrote nothing")
    ap.add_argument("--name", help="name for results/<name>.json (default: the output file's name)")
    ap.add_argument("--show", type=int, default=5, help="example differing rows to keep (default 5)")
    args = ap.parse_args()
    if not args.output and not args.no_output:
        ap.error("give the output file, or --no-output if the run wrote nothing")

    out = None if args.no_output else read_table(args.output)
    r = compare(read_table(args.input), out, args.show)
    r = {"input_file": str(args.input), "output_file": None if args.no_output else str(args.output), **r}
    r["reasons"] = verdict(r)
    r["verdict"] = "PASS" if not r["reasons"] else "FAIL"

    name = args.name or (args.output.stem if args.output else args.input.stem)
    path = ROOT / "data-validation" / "results" / f"{name}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(r, indent=2, default=str))
    print_report(name, r)
    print(f"\n  full result: {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
