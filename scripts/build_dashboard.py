"""Build the observability dashboard (dashboard/) from the recorded data.

Every number on the page comes from a file in the repo:
  data-validation/rhombus-runs.csv   every Rhombus run attempt: outcome, where it stopped, how long it took
  data-validation/consistency.csv    output files from the same input, with their sha256
  data-validation/results/*.json     the validator's verdict for each run
  datasets/*.csv + the downloaded outputs, which the page's diff tool compares in the browser
The capability heat map is my judgement per case; each cell links to the write-up behind it.

Usage:
    python scripts/build_dashboard.py      # writes dashboard/index.html and dashboard/data/ (static, for GitHub Pages)
"""
import csv
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard"
REPO = "https://github.com/BlueZed15/rhomb/blob/main/"

SCENARIOS = [
    # file stem (also the id in rhombus-runs.csv and results/), short id, label, change, family, write-up
    ("baseline", "baseline", "Baseline", "no change", "Baseline", "observations/baseline.md"),
    ("schema-drift1-drop-column", "schema-drift1", "Drop column", "Brand removed", "Schema drift", "observations/schema-drift1-drop-column.md"),
    ("schema-drift2-rename-column", "schema-drift2", "Rename column", "Price → PriceCentsPerLitre", "Schema drift", "observations/schema-drift2-rename-column.md"),
    ("schema-drift3-change-type", "schema-drift3", "Change type", "2174 → NSW 2174", "Schema drift", "observations/schema-drift3-change-type.md"),
    ("schema-drift4-add-column", "schema-drift4", "Add column", "new IsDiscounted", "Schema drift", "observations/schema-drift4-add-column.md"),
    ("schema-drift5-combined", "schema-drift5", "All four at once", "every schema change", "Combined drift", "observations/schema-drift5-combined.md"),
    ("semantic-drift1-cents-to-dollars", "semantic-drift1", "Cents → dollars", "253.9 → 2.539", "Semantic drift", "observations/semantic-drift1-cents-to-dollars.md"),
    ("semantic-drift2-date-mmdd", "semantic-drift2", "Dates as MM/DD", "17/09 → 09/17", "Semantic drift", "observations/semantic-drift2-date-mmdd.md"),
]

# Heat map: 3 = handled, 2 = partly, 1 = fails, 0 = not applicable. Verdict uses the spec's words.
CAPABILITIES = [
    ("detects", "Notices the change"),
    ("cause", "Error points at the cause"),
    ("data", "Data in GCS is right"),
    ("chatbot", "Chatbot fixes it alone"),
    ("schedule", "Schedule notices"),
]
HEAT = {
    "schema-drift1-drop-column": ("breaks", "Stops with a clear error; nothing gets fixed", {
        "detects": (3, "Stops at the step that uses Brand."),
        "cause": (3, "The error names the step and the missing column."),
        "data": (3, "Nothing is written, so no wrong data reaches GCS."),
        "chatbot": (1, "Wrong diagnosis, and its edit never changed the code that runs (same code_sha)."),
        "schedule": (1, "Skipped as \"unchanged data\"; the failure isn't in its history."),
    }),
    "schema-drift2-rename-column": ("breaks", "Stops with a clear error; nothing gets fixed", {
        "detects": (3, "Stops at the first step that uses Price."),
        "cause": (3, "The error names the step and the missing column."),
        "data": (3, "Nothing is written."),
        "chatbot": (1, "Right diagnosis, but the code that runs never changed (same code_sha)."),
        "schedule": (1, "Skipped as \"unchanged data\"."),
    }),
    "schema-drift3-change-type": ("breaks", "Stops, but blames a step two places later", {
        "detects": (2, "Only a passing popup: \"postcode_clean: No results found\"."),
        "cause": (1, "The error names dedup_final, two steps after the real cause."),
        "data": (3, "Nothing is written."),
        "chatbot": (1, "Blamed date_format; its fix failed."),
        "schedule": (1, "The schedule never re-reads the file (seen in schema-drift1 and schema-drift2)."),
    }),
    "schema-drift4-add-column": ("handled", "The new column flows through; the chatbot's later fix loses rows", {
        "detects": (2, "The new column passes through without a warning."),
        "cause": (2, "The errors were about wiped step settings, not the column."),
        "data": (1, "After the chatbot's fixes, 57 rows are silently missing."),
        "chatbot": (1, "4 prompts; its replacement steps had empty prompts."),
        "schedule": (1, "The schedule never re-reads the file."),
    }),
    "schema-drift5-combined": ("breaks", "Fails one column at a time, then \"succeeds\" with an empty file", {
        "detects": (2, "Stops, but reports one column at a time."),
        "cause": (2, "Each error names one column; the first is a bare KeyError."),
        "data": (1, "\"Success\" with a header-only file, 0 rows."),
        "chatbot": (1, "Looked at the wrong file; its fixes made the failure silent."),
        "schedule": (1, "A scheduled run would report success."),
    }),
    "semantic-drift1-cents-to-dollars": ("missed", "Reports success and writes 0 rows", {
        "detects": (2, "A passing \"No results found\" popup, nothing about units."),
        "cause": (1, "No error at all."),
        "data": (1, "\"Success\" with 0 rows."),
        "chatbot": (0, "Nothing failed, so there was nothing to give it."),
        "schedule": (1, "A scheduled run would be green."),
    }),
    "semantic-drift2-date-mmdd": ("missed", "No warning; right only because Rhombus guesses month-first", {
        "detects": (1, "No warning of any kind."),
        "cause": (0, "No error."),
        "data": (2, "Correct here by luck; the same guess swaps 733 Australian dates in the baseline."),
        "chatbot": (0, "Nothing failed."),
        "schedule": (1, "A scheduled run would be green."),
    }),
}

# Files the diff tool can compare. Inputs are served from datasets/; one output per case is copied into dashboard/data/.
# (Repeat runs of the same input were byte-identical, so they're counted in consistency.csv instead of listed here.)
INPUTS = [
    ("baseline.csv", "baseline · input"),
    ("baseline_expected.csv", "baseline · answer key (correct cleaned output)"),
    ("schema-drift1-drop-column.csv", "schema-drift1 · drop column · input"),
    ("schema-drift2-rename-column.csv", "schema-drift2 · rename column · input"),
    ("schema-drift3-change-type.csv", "schema-drift3 · change type · input"),
    ("schema-drift4-add-column.csv", "schema-drift4 · add column · input"),
    ("schema-drift5-combined.csv", "schema-drift5 · all four at once · input"),
    ("semantic-drift1-cents-to-dollars.csv", "semantic-drift1 · cents → dollars · input"),
    ("semantic-drift2-date-mmdd.csv", "semantic-drift2 · dates as MM/DD · input"),
]
OUTPUTS = [
    ("output_baseline.csv", "baseline", "baseline · output"),
    ("output_schema-drift4-add-column.csv", "schema-drift4-add-column", "schema-drift4 · add column · output"),
    ("output_schema-drift5-combined.csv", "schema-drift5-combined", "schema-drift5 · all four at once · output"),
    ("output_semantic-drift1-cents-to-dollars.csv", "semantic-drift1-cents-to-dollars", "semantic-drift1 · cents → dollars · output"),
    ("output_semantic-drift2-date-mmdd.csv", "semantic-drift2-date-mmdd", "semantic-drift2 · dates as MM/DD · output"),
]


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    runs = read_csv(ROOT / "data-validation" / "rhombus-runs.csv")
    for r in runs:
        r["first_after_build"] = "writes each step's code" in r["note"]

    data_dir = OUT / "data"
    if data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True)
    files = [{"group": "Inputs", "label": label, "path": f"../datasets/{name}"} for name, label in INPUTS]
    for src, scenario, label in OUTPUTS:
        p = ROOT / "data-validation" / "downloads" / src
        if not p.exists():
            print(f"skipped {src} (not downloaded)")
            continue
        shutil.copyfile(p, data_dir / f"{scenario}.csv")
        files.append({"group": "Outputs", "label": label, "path": f"data/{scenario}.csv", "scenario": scenario,
                      "sha": hashlib.sha256(p.read_bytes()).hexdigest()[:12]})

    # Output consistency: every saved output of the same input, from consistency.csv
    consistency = {}
    for r in read_csv(ROOT / "data-validation" / "consistency.csv"):
        consistency.setdefault(r["input"], []).append({"file": r["output_file"], "time": r["run_time"], "pipeline": r["pipeline"], "sha": r["sha256"]})

    scenarios = []
    for sid, short, label, change, family, writeup in SCENARIOS:
        res = json.loads((ROOT / "data-validation" / "results" / f"{sid}.json").read_text())
        heat = HEAT.get(sid)
        scenarios.append({
            "id": sid, "short": short, "label": label, "change": change, "family": family,
            "part": "Part 2" if short.startswith("schema") else "Part 3" if short.startswith("semantic") else "",
            "writeup": REPO + writeup, "result": REPO + f"data-validation/results/{sid}.json",
            "verdict": res.get("verdict"), "reasons": res.get("reasons", []),
            "expected_rows": res.get("expected_rows"), "output_rows": res.get("output_rows"),
            "heat": None if heat is None else {"verdict": heat[0], "summary": heat[1],
                                               "cells": {k: {"score": v[0], "why": v[1]} for k, v in heat[2].items()}},
            "runs": [r for r in runs if r["scenario"] == sid],
            "consistency": consistency.get(sid, []),
        })

    data = {
        "scenarios": scenarios, "capabilities": CAPABILITIES, "files": files,
        "sources": {
            "consistency_csv": REPO + "data-validation/consistency.csv",
            "runs": REPO + "data-validation/rhombus-runs.csv",
            "consistency": REPO + "data-validation/consistency.csv",
            "results": REPO + "data-validation/results",
            "builder": REPO + "scripts/build_dashboard.py",
            "readme": REPO + "README.md",
        },
    }
    template = (ROOT / "scripts" / "dashboard_template.html").read_text(encoding="utf-8")
    (OUT / "index.html").write_text(template.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    print(f"wrote dashboard/index.html and {sum(f['group'] == 'Outputs' for f in files)} output files in dashboard/data/")


if __name__ == "__main__":
    main()
