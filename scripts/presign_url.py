"""Print a presigned GET URL for one S3 object, valid up to 7 days.

Signs with the IAM user keys in .env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
Console or CloudShell credentials won't do: their URLs die with the session (~12h).

Usage:
    python scripts/presign_url.py "input/customers.csv"
    python scripts/presign_url.py "input/test.csv" --open   # also opens it in your browser
    python scripts/presign_url.py "input/test.csv" --copy   # also copies it, ready to paste into Rhombus
"""
import argparse
import os
import subprocess
import webbrowser
from pathlib import Path

import boto3
from botocore.config import Config

MAX_SECONDS = 7 * 24 * 60 * 60  # SigV4 hard limit


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    load_env(Path(__file__).resolve().parent.parent / ".env")

    parser = argparse.ArgumentParser()
    parser.add_argument("key", help="object key in the bucket")
    parser.add_argument("--bucket", default=os.environ.get("S3_SOURCE_BUCKET", "rhombus-input-data"))
    parser.add_argument("--days", type=float, default=7)
    parser.add_argument("--open", action="store_true", help="open the URL in the default browser")
    parser.add_argument("--copy", action="store_true", help="copy the URL to the clipboard (Windows)")
    parser.add_argument("--inline", action="store_true",
                        help="serve as plain text shown in the browser, not a file download")
    args = parser.parse_args()

    seconds = min(int(args.days * 86400), MAX_SECONDS)
    region = os.environ.get("AWS_REGION", "ap-southeast-2")
    s3 = boto3.client("s3", region_name=region, config=Config(signature_version="s3v4"))

    s3.head_object(Bucket=args.bucket, Key=args.key)  # fail fast if the key or access is wrong
    params = {"Bucket": args.bucket, "Key": args.key}
    if args.inline:
        params["ResponseContentType"] = "text/plain; charset=utf-8"
        params["ResponseContentDisposition"] = "inline"
    url = s3.generate_presigned_url("get_object", Params=params, ExpiresIn=seconds)
    print(url)
    if args.open:
        webbrowser.open(url)
    if args.copy:
        subprocess.run("clip", input=url, text=True, check=True)
        print("(copied to clipboard)")


if __name__ == "__main__":
    main()
