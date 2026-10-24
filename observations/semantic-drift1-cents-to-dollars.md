# semantic-drift1 (Part 3) · Prices in dollars instead of cents

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `semantic-drift1` · [validation](../data-validation/results/semantic-drift1-cents-to-dollars.json) |
| Input | [`datasets/semantic-drift1-cents-to-dollars.csv`](../datasets/), `Table 1 (6).csv` in Rhombus |
| Change | `Price` in dollars: `253.9` → `2.539`. Same column, same type, same schema. |
| Drift pipeline before run | Reset to the baseline, pre-check `503fd6ed…` (01:19:39) |
| Did Rhombus notice? | **Partly.** A canvas card says the price step returned no rows, and the run fails at dedup. Nothing about units |
| Did my validation catch it? | **Yes.** No output where my rules expect 38 rows |
| Reached GCS | Nothing |
| Chatbot fix worked? | **No.** It inspected the wrong file and blamed a missing `Brand` |
| Severity | **High** (stops, but nothing points at the cause) |

## What I expected (written before the run)
The price step drops every row (2.5 is outside 100–400), so it either fails on an empty table or writes a 0-row file. Nothing about units.

## What happened
With the built-ins back on baseline values, the run at 01:25:36 failed at 01:25:58:

```text
Pipeline failed at drift_dedup: DataFrame should not be empty.
```
The canvas card said "drift_price_clean: No results found after applying this LLM transformation" and "drift_date_format: No results found after applying this filter" ([screenshot](evidence/drift/21-semantic-drift1-cents-to-dollars-price-step-empties-table.jpg)). Nothing reached GCS.

**Repeats (consistency):** 3 more runs at 07:17–07:18 on 24 Oct all failed at `drift_dedup` ("DataFrame should not be empty") ([consistency.csv](../data-validation/consistency.csv)).

## Does Rhombus notice?
It notices the table went empty and names the price step, but on the canvas, not in the error. Nothing says the values look like dollars, even though every price shrank by 100×. A customer gets "DataFrame should not be empty" from the dedup step.

## Does my validation catch it?
Yes. My rules applied to this file give 38 rows. These are the `219.9c`-style values, which still read as cents after stripping the `c`. Rhombus wrote nothing, so it's a FAIL. A semantic check on the output alone would also flag it (a median price around 2.4).

## The chatbot
Lattice, 01:26:56 (46 s). I asked even though it's a semantic case, to see if it would spot the units.
- **Diagnosis: wrong.** It "materialized Table 1 (1).csv", the schema-drift1 file, not the input in use, found `Brand` missing and blamed that. It never looked at the price values.
- **Fix:** it replaced `drift_brand_normalise` with a skip-if-missing version and **edited the built-in Remove Duplicates** down to 7 columns, dropping `Brand` ([screenshot](evidence/drift/22-semantic-drift1-cents-to-dollars-chatbot-blames-missing-brand.jpg)).
- **Re-run** 01:29:13 → 01:29:41: the same error ([screenshot](evidence/drift/23-semantic-drift1-cents-to-dollars-rerun-still-empty.jpg)).

## The schedule afterwards
#19933 (01:25) and #19937 (01:30, after the fix) both failed at Remove Duplicates ([screenshot](evidence/drift/24-semantic-drift1-cents-to-dollars-scheduled-runs-fail.jpg)).

## What I think
Here the cleaning rules work as a guard: the 100–400 range catches the unit change by accident. Without that rule, dollar prices would have gone straight to GCS. The chatbot made it worse by changing a step and a built-in setting for a column that wasn't missing.

## Reproduce
Same as [schema-drift1](schema-drift1-drop-column.md#reproduce), with `Table 1 (6).csv`, then `python data-validation/validate.py datasets/semantic-drift1-cents-to-dollars.csv --no-output --name semantic-drift1-cents-to-dollars`.
