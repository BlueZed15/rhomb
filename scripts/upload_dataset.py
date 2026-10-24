"""Put one dataset version live in S3, keep a named copy, and log the run.

The live object is input/fuelcheck.xlsx. A copy also goes to input/archive/fuelcheck_<case>.xlsx,
which scripts/import-inputs.mjs imports into Rhombus (D5), and the case is logged in
data-validation/runs.csv so each case ID maps to its input and output.

Usage:
    python scripts/upload_dataset.py schema-drift1-drop-column
    python scripts/upload_dataset.py baseline --archive-only   # live file already in place
"""
import argparse
import csv
import os
from datetime import datetime, timezone
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data-validation" / "runs.csv"
LIVE_KEY = "input/fuelcheck.xlsx"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FIELDS = ["case", "archive_key", "live_version_id", "uploaded_at", "gcs_output", "notes"]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def log_run(row: dict) -> None:
    new = not RUNS.exists()
    with RUNS.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            writer.writeheader()
        writer.writerow(row)


def main() -> None:
    load_env(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("case", help="dataset name in datasets/xlsx/, without .xlsx (e.g. schema-drift1-drop-column)")
    parser.add_argument("--archive-only", action="store_true",
                        help="only store the archive copy; don't touch the live file")
    parser.add_argument("--notes", default="")
    args = parser.parse_args()

    path = ROOT / "datasets" / "xlsx" / f"{args.case}.xlsx"
    bucket = os.environ.get("S3_SOURCE_BUCKET", "rhombus-input-data")
    s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "ap-southeast-2"))
    archive_key = f"input/archive/fuelcheck_{args.case}.xlsx"

    body = path.read_bytes()
    s3.put_object(Bucket=bucket, Key=archive_key, Body=body, ContentType=XLSX_TYPE)
    print(f"archived  {path.name} -> s3://{bucket}/{archive_key}")

    if args.archive_only:
        version = s3.head_object(Bucket=bucket, Key=LIVE_KEY).get("VersionId")
        print(f"live file left as is (VersionId {version})")
    else:
        version = s3.put_object(Bucket=bucket, Key=LIVE_KEY, Body=body, ContentType=XLSX_TYPE).get("VersionId")
        print(f"live      {path.name} -> s3://{bucket}/{LIVE_KEY} (VersionId {version})")

    log_run({"case": args.case, "archive_key": archive_key,
             "live_version_id": version, "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "gcs_output": "", "notes": args.notes})
    print(f"logged {args.case} in {RUNS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
