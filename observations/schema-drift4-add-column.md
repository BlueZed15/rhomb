# schema-drift4 (Part 2) · Add a column (`IsDiscounted`)

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift4` · [validation](../data-validation/results/schema-drift4-add-column.json) |
| Input | [`datasets/schema-drift4-add-column.csv`](../datasets/), `Table 1 (4).csv` in Rhombus |
| Change | A new `IsDiscounted` column (`Y`/`N`) after `FuelCode`. Everything else matches the baseline. |
| Drift pipeline before run | Reset to the baseline, pre-check `503fd6ed…` (00:39:45) |
| Stopped? | **No.** Silent success |
| Reached GCS | 2,363 rows, 9 columns (`0c977f10…`, `rhom-1/schema-drift4-add-column/drift-output.csv`) |
| Chatbot fix worked? | n/a (nothing failed) |
| Severity | **Low** (handled, but no warning that the schema changed) |

## What I expected (written before the run)
The LLM steps keep extra columns, and dedup is set on the 8 named columns, so it carries on. 9 columns reach GCS, with no warning.

## What happened
Exactly that. After the usual setup re-runs (the input switch wipes the built-ins), the run at 00:44:23 succeeded at 00:44:43 with no warning ([screenshot](evidence/drift/15-schema-drift4-add-column-run-succeeds.jpg)).

- The output has the baseline's 2,363 rows plus `IsDiscounted`. Drop the new column and it's identical to the baseline output.
- The log line shows the whitespace step touched 20,857 cells instead of 18,244. That's one extra per row, so the new column went through cleaning too.
- My validator says FAIL: 2,363 rows out, 2,458 expected. My rule removes only exact duplicates, so it keeps 57 pairs that differ only in `IsDiscounted`. Rhombus's dedup only looks at the 8 named columns, so it merged those 57 without saying so. Which is right depends on whether `IsDiscounted` matters to the customer. The point is that nothing told them a new column had appeared.

**Repeats (consistency):** 3 more runs at 07:03–07:05 on 24 Oct all wrote the same file, `0c977f10…`: 5 identical outputs in all ([consistency.csv](../data-validation/consistency.csv)). On the third, the page never showed the run finish, though the file landed 21 s after it started.

## The logs
Nothing to explain: green run, no mention of the new column.

## The chatbot
Not used: nothing failed.

## The schedule afterwards
Both scheduled runs succeeded: #19886 (00:40, the pre-check config) and #19892 (00:45:20, 19.6 s, the drift file), which wrote the same `0c977f10…` file ([screenshot](evidence/drift/16-schema-drift4-add-column-scheduled-run-succeeds.jpg)).

## What I think
This is the friendly kind of drift, and Rhombus handles it fine. The gap is visibility: a new column flows to GCS and into the cleaning steps without any notice, and the dedup quietly ignores it.

## Reproduce
Same as [schema-drift1](schema-drift1-drop-column.md#reproduce), with `Table 1 (4).csv`.
