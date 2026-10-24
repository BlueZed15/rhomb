# data-validation/

[`validate.py`](validate.py) compares a pipeline's output with the input it was given and tells you what's different. You give it two files, the one the pipeline read (CSV or XLSX), and the one it wrote to GCS.

```bash
python data-validation/validate.py datasets/baseline.csv dashboard/data/baseline.csv
python data-validation/validate.py datasets/schema-drift1-drop-column.csv --no-output     # the run wrote nothing
```

It prints a short report and saves the full result as JSON in [`results/`](results/). Here's what the baseline looks like (shortened):

```text
baseline
  input     2613 rows, 8 columns
  expected  2401 rows
  output    2363 rows, content sha256 d86f4143d7f92633 (rows sorted, so order doesn't matter)
  rows      1630 match, 771 missing or different, 733 unexpected
     missing    7-Eleven Albion Park Rail | ... | U91 | 08/09/2026 10:54:15 | 213.9
     unexpected 7-Eleven Albion Park Rail | ... | U91 | 09/08/2026 10:54:15 | 213.9
  semantic  {'dates_outside_source_month': 733, ...}

  FAIL
   - 2363 rows out, 2401 expected
   - 771 expected rows are missing or different
   ...
```
The example rows show the actual difference: Rhombus turned 8 September into 9 August.

## How it decides what's "expected"
It applies my 9 cleaning rules ([`check_answer_key.py`](../datasets/check_answer_key.py)) to the input. These are the same rules the AI builder was given, so the same script works for the baseline and for every drifted file. If the input's schema has drifted so far that the rules can't run (e.g. `Price` is missing), it says so.

## What it checks
- **Schema**, meaning missing or extra columns compared with the baseline
- **Row counts** for the input, the expected output and the actual output
- **Rows**, meaning how many match, and examples of the ones that are missing or unexpected
- **Repeatability**, from a sha256 of the output's rows (sorted, so row order doesn't matter). [`consistency.csv`](consistency.csv) and the dashboard use the plain file sha256, which is stricter.
- **Semantic checks on the output alone**, because a semantic drift can pass every rule:
  - prices outside each fuel's normal range, and the median price
  - dates that don't parse as DD/MM, or that fall outside the source month
  - fuel ordering (on the same day, a station's E10 ≤ U91 ≤ P98)

**PASS** means the output is exactly what the rules should produce. Anything else is **FAIL**, with every reason listed.

## Results for every run
| Case | Input | Verdict | Main reasons |
|---|---|---|---|
| [baseline](results/baseline.json) | baseline | FAIL | 733 dates swapped, 38 rows dropped |
| [schema-drift1](results/schema-drift1-drop-column.json) · [schema-drift2](results/schema-drift2-rename-column.json) · [schema-drift5](results/schema-drift5-combined.json) | drop / rename / all four | FAIL | no output was written |
| [schema-drift3](results/schema-drift3-change-type.json) | change type | FAIL | the rules expect 0 rows; the chatbot-fixed output has 2,367, 4 with a made-up postcode |
| [schema-drift4](results/schema-drift4-add-column.json) | add column | FAIL | extra column; 57 rows that differ only in it were merged by dedup |
| [semantic-drift1](results/semantic-drift1-cents-to-dollars.json) | cents → dollars | FAIL | no output, 38 rows expected |
| [semantic-drift2](results/semantic-drift2-date-mmdd.json) | dates as MM/DD | FAIL | see the known limit below |

[`runs.csv`](runs.csv) records which S3 input and GCS output belong to each case. Downloaded outputs go in `downloads/` (gitignored).

Two more records feed the [dashboard](../dashboard/index.html):
- [`rhombus-runs.csv`](rhombus-runs.csv): every Rhombus run attempt, with what started it, how it ended, where it stopped, and how long it took (from Rhombus's log timestamps). Setup runs (my resets, and runs that failed only because switching the input wiped a built-in step or the output) are marked `counted = no`.
- [`consistency.csv`](consistency.csv): repeat runs of every setup. The baseline file's 16 outputs (both pipelines) are byte-identical; schema-drift4 (5 runs) and semantic-drift2 (4) are identical too. For the five cases that write nothing, each row records where the run failed and the error's `code_sha`, which was the same on all 3 runs.

## Known limit
It trusts my rules. On the MM/DD case, Rhombus's own date guess happened to be right, and my DD/MM rule made the "expected" side wrong. There I compared against the answer key instead ([details](../observations/semantic-drift2-date-mmdd.md)).
