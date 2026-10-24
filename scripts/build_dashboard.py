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
    "schema-drift1-drop-column": ("breaks", "Stops at the right step; the chatbot's fix lands on the baseline", {
        "detects": (3, "Stops at the step that uses Brand."),
        "cause": (2, "Names the step, but the error is a bare KeyError: 'Brand'."),
        "data": (3, "Nothing is written, so no wrong data reaches GCS."),
        "chatbot": (1, "Blamed nulls, and edited the baseline pipeline instead of the drift copy (same code_sha on re-run)."),
        "schedule": (2, "Recorded every failure for 45 min, then turned itself Inactive with no notice."),
    }),
    "schema-drift2-rename-column": ("breaks", "Stops with a clear error; the chatbot's fix moves the break", {
        "detects": (3, "Stops at the first step that uses Price."),
        "cause": (3, "The error names the step and the missing column."),
        "data": (3, "Nothing is written."),
        "chatbot": (1, "Rewrote the code for the new name; dedup then fails, and the step breaks on the original file."),
        "schedule": (2, "Kept running and recorded the failures at Remove Duplicates."),
    }),
    "schema-drift3-change-type": ("breaks", "Stops two steps late; the chatbot's fix makes up postcodes", {
        "detects": (2, "A canvas card flags postcode_clean (\"No results found\"), not the error."),
        "cause": (1, "The error is \"DataFrame should not be empty\" at dedup, two steps after the cause."),
        "data": (1, "After the chatbot's fix, a green run writes 4 rows with a made-up postcode 2999."),
        "chatbot": (2, "The run passes by itself, but the fix changes the postcode rule."),
        "schedule": (2, "Recorded the failure, then the fixed success, then skipped as unchanged data."),
    }),
    "schema-drift4-add-column": ("handled", "The new column flows through silently", {
        "detects": (1, "No warning that a column appeared."),
        "cause": (0, "No error."),
        "data": (2, "The baseline's rows plus the new column; dedup ignores it and merges 57 rows."),
        "chatbot": (0, "Nothing failed."),
        "schedule": (3, "The scheduled run succeeded with the same output."),
    }),
    "schema-drift5-combined": ("breaks", "Reports one missing column; the chatbot's \"replacement\" changes nothing", {
        "detects": (2, "Stops, but only on the first missing column."),
        "cause": (2, "Names Price; says nothing about Brand, Postcode or the new column."),
        "data": (3, "Nothing is written."),
        "chatbot": (1, "Wrong file, wrong cause; \"replaced\" 6 steps and the same code_sha ran."),
        "schedule": (1, "A scheduled run and a manual run a minute apart ran different code."),
    }),
    "semantic-drift1-cents-to-dollars": ("breaks", "Fails on an empty table; nothing about units", {
        "detects": (2, "A canvas card says price_clean returned no rows; nothing about dollars."),
        "cause": (1, "\"DataFrame should not be empty\" at dedup."),
        "data": (3, "Nothing is written."),
        "chatbot": (1, "Inspected the wrong file and blamed a missing Brand; cut Brand from dedup."),
        "schedule": (2, "Recorded the failures."),
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
# (Repeat runs of the baseline file were byte-identical, so they're counted in consistency.csv instead of listed here.
# schema-drift1/2/5 and semantic-drift1 wrote nothing.)
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
    ("fuelcheck-baseline_1792739703234.csv", "baseline", "baseline · output"),
    ("fuelcheck-schema-drift3-change-type_1792761882629.csv", "schema-drift3-change-type", "schema-drift3 · change type · output after the chatbot's fix"),
    ("fuelcheck-schema-drift4-add-column_1792763081047.csv", "schema-drift4-add-column", "schema-drift4 · add column · output"),
    ("fuelcheck-semantic-drift2-date-mmdd_1792766773792.csv", "semantic-drift2-date-mmdd", "semantic-drift2 · dates as MM/DD · output"),
]


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    runs = read_csv(ROOT / "data-validation" / "rhombus-runs.csv")
    for r in runs:
        # Runs over a minute are the ones where Rhombus writes a step's code (first run, or right after a chatbot fix)
        r["first_after_build"] = float(r["duration_s"] or 0) > 60

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
            "d15": REPO + "docs/decisions.md#d15-a-different-chart-for-each-dashboard-view",
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
