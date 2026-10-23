# schema-drift1 (Part 2) · Drop a column (`Brand`)

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift1` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/schema-drift1-drop-column.json) |
| Input | `input/archive/fuelcheck_1_schema-drop-column.xlsx`, live VersionId `yzFbRGD.axxWcIGD.fC_l1SCPmuB5ySd` |
| Change | The `Brand` column is removed. Everything else matches the baseline. |
| Pipeline before run | **Clean baseline** (project `drift1`, exactly as it was for the baseline run) |
| Stopped? | **Yes**, at `brand_case_fix` (node 4) |
| Reached GCS | Nothing |
| Chatbot fix worked? | **No.** It misdiagnosed the cause, and the code didn't change. |
| Severity | **Medium** (fails clearly, but the chatbot's fix doesn't work), plus the schedule problem below |

## What I expected (written before the run)
`brand_case_fix` checks for `Brand` and raises `ValueError("Column 'Brand' does not exist…")`, so I expect the run to **stop at node 4 with a clear error** and nothing to reach GCS.

There's a catch, though. Rhombus imported the baseline once as "Table 1.csv", so I'm not sure a scheduled run reads the new file at all. If it doesn't, the run will just repeat the baseline output and never see the drift. This run tests that too.

## What happened
**The schedule never saw the drift on its own.** I uploaded the new file to S3 and turned the schedule back on (every 5 min). The 14:00 run didn't happen, and the card just said:

> Skipped 1 time(s) in a row due to unchanged data.

([screenshot](evidence/drift/01-schedule-skipped-unchanged-data.jpg))

Rhombus compares against its own stored copy ("Table 1.csv", imported once through From Web URL), not the file in S3, and the Data Input has no refresh button. So **a scheduled pipeline on this source never picks up an upstream change**, and the only clue is a grey line on the schedule card. Nothing lands in the run history.

**So I re-imported the same link,** which now serves the drifted file. Selecting the new dataset ("Table 1 (1).csv") **started a run straight away** (14:06:40), and it stopped exactly where I expected:

```text
Pipeline failed at brand_case_fix: LLM execution failed (code_sha=f94ab9aee6a4):
Column 'Brand' does not exist in output_df! --- Generated code --- import pandas as pd ...
```
Nothing reached GCS. My validator agrees. It found [no output](../data-validation/results/schema-drift1-drop-column.json), and `Brand` is listed as missing from the input schema.

## The logs
The error is actually good, because it names the node and the column. But two things undercut it:
- The **same second** also logs "Pipeline execution completed successfully." ([screenshot](evidence/drift/02-schema-drift1-brand-error-and-skips.jpg))
- The message then dumps the generated Python, which is noise for most users.

## The chatbot
I clicked **Ask Chatbot** on the error (it prefills "Please help me fix the following error…") and sent it on Lattice (Opus 4.6).

- Its diagnosis was "the re-uploaded dataset may have slightly different column headers". Not quite. `Brand` is gone entirely, and it never looked at the data to check.
- For the fix, it rewrote `brand_case_fix` to find `Brand` case-insensitively and "pass through gracefully" if it's missing. Even if that worked, it would turn a loud failure into a silent one: the output would just be missing a column.
- **Did it work?** No. I re-ran and got the **same error with the same `code_sha=f94ab9aee6a4`** ([screenshot](evidence/drift/03-schema-drift1-fix-same-code-sha.jpg)). It changed the node's prompt, but the code that runs stayed the same. I hit this same gap while building the baseline.

## The schedule afterwards
It stays **Active**, but every 5 minutes it logs "Skipped N time(s) in a row due to unchanged data". It doesn't retry the failed run and doesn't show the failure in the schedule's run history. As far as the schedule is concerned, nothing is wrong.

## What I think
The pipeline did the right thing: it stopped loudly on a missing column. The problems are around it. The schedule can't see upstream changes, so it never notices it's broken, and the chatbot's fix neither targets the real cause nor actually changes the code.

## Reproduce
1. `python scripts/upload_dataset.py schema-drift1-drop-column`
2. Data Input → From Web URL → paste a link from `python scripts/presign_url.py input/fuelcheck.xlsx --copy` → import → select the new table → Apply (this starts a run).
3. Logs → Ask Chatbot → apply its change → Run.
4. `python data-validation/validate.py datasets/schema-drift1-drop-column.csv --no-output` (the run wrote nothing)
