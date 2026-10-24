# semantic-drift2 (Part 3) · Dates as MM/DD instead of DD/MM

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `semantic-drift2` · [validation](../data-validation/results/semantic-drift2-date-mmdd.json) |
| Input | [`datasets/semantic-drift2-date-mmdd.csv`](../datasets/), `Table 1 (7).csv` in Rhombus |
| Change | `PriceUpdatedDate` written month-first: `17/09/2026` → `09/17/2026` |
| Drift pipeline before run | Reset to the baseline, pre-check `503fd6ed…` (01:40:51) |
| Did Rhombus notice? | **No.** Silent success |
| Did my validation catch it? | **It flagged it, but on the wrong side.** The answer key shows Rhombus's output is right |
| Reached GCS | 2,363 rows (`de296e18…`), every one correct |
| Chatbot fix worked? | n/a (nothing failed) |
| Severity | **Low** for this file. It's the same date guessing that makes the baseline **Critical** |

## What I expected (written before the run)
The import guesses month-first, so US dates parse correctly. A silent success, an output more correct than the baseline, and no warning.

## What happened
With the built-ins back on baseline values, the run at 01:46:01 succeeded at 01:46:20 with no warning ([screenshot](evidence/drift/25-semantic-drift2-date-mmdd-silent-success.jpg)). The output is in GCS as `rhom-1/semantic-drift2-date-mmdd/drift-output.csv`.

**Repeats (consistency):** 2 more manual runs (06:58 on 24 Oct) and the 01:50 scheduled run wrote the same file, `de296e18…`: 4 identical outputs ([consistency.csv](../data-validation/consistency.csv)).

## Does Rhombus notice?
No, and here that's lucky. Rhombus reads slash dates month-first. On the baseline (DD/MM) that swaps 733 dates. On this file (MM/DD) it's right.

## Does my validation catch it?
My validator says FAIL: 2,363 rows out, 2,394 expected, 2,281 not in the expected output. But its "expected" output applies my DD/MM rule to a month-first file, so it's the validator that's wrong here. Against the answer key (the correct output my dataset script writes):
- **All 2,363 output rows are correct.** The baseline output gets 1,630.
- The only gap is the same 38 `c`-price rows the baseline also drops.

So my validator catches that the dates changed, but only the answer key says who's right.

## The chatbot
Not used: nothing failed.

## The schedule afterwards
The 01:50 scheduled run on this file succeeded and wrote the same output. After that the schedule paused itself ("paused after 5 consecutive skips due to unchanged data").

## What I think
A date-format change should be the scariest semantic drift, and here it came out right by accident. The real finding is the guess itself: Rhombus picks a date order at import without saying so, and the same guess quietly swaps 733 dates in the baseline.

## Reproduce
Same as [schema-drift1](schema-drift1-drop-column.md#reproduce), with `Table 1 (7).csv`, then `python data-validation/validate.py datasets/semantic-drift2-date-mmdd.csv <output> --name semantic-drift2-date-mmdd` and a join against `datasets/baseline_expected.csv`.
