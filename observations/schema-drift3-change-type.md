# schema-drift3 (Part 2) · Change a column's type (`2174` → `NSW 2174`)

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift3` · [validation](../data-validation/results/schema-drift3-change-type.json) |
| Input | [`datasets/schema-drift3-change-type.csv`](../datasets/), `Table 1 (3).csv` in Rhombus |
| Change | `Postcode` goes from a number to text with a state prefix: `2174` → `NSW 2174` |
| Drift pipeline before run | Reset to the baseline, pre-check `503fd6ed…` (00:10:16) |
| Stopped? | **Yes**, but at dedup, two steps after the real cause |
| Reached GCS | Nothing from the drift run. After the chatbot's fix, 2,367 rows, **4 with a made-up postcode** (`rhom-1/schema-drift3-change-type/output-after-chatbot-fix.csv`) |
| Chatbot fix worked? | **Partly.** The run passes by itself, but the fix changes the rule and lets bad rows through |
| Severity | **High** (unhelpful error), and **Critical** after the chatbot's fix (wrong data, green run) |

## What I expected (written before the run)
The postcode step drops every row (none are 4 digits), so the table is empty, and dedup then fails or passes 0 rows. Either way the error won't point at postcode.

## What happened
Switching the input wipes the drift pipeline's built-in settings, so the first two runs failed on that (setup, not counted). With Text Case and Remove Duplicates back on the baseline values and the output set, the run at 00:19:22 failed at 00:19:36:

```text
Pipeline failed at drift_dedup: DataFrame should not be empty.
Pipeline execution completed successfully.
```
([screenshot](evidence/drift/11-schema-drift3-change-type-fails-at-dedup-empty-dataframe.jpg)). Nothing reached GCS. My prediction held.

**Rhombus did notice something.** An orange card on the canvas said "drift_postcode_clean: No results found after applying this LLM transformation. If there is an issue, consider undoing the last step" ([screenshot](evidence/drift/10-schema-drift3-change-type-postcode-empties-table-warning.jpg)). That's the right step. The card has no close button and covers the newest log entry.

**Repeats (consistency):** 3 more runs at 07:13–07:14 on 24 Oct, with the built-ins on baseline values, all failed at `drift_dedup` ("DataFrame should not be empty"). The post-fix output can't be repeated without a new chatbot answer; its two runs were identical ([consistency.csv](../data-validation/consistency.csv)).

## The logs
The error names dedup, two steps after the cause, and says nothing about postcodes. You only find the cause if you see the canvas card.

## The chatbot
Lattice, 00:21:12 (about 1 min).
- **Diagnosis: partly right.** "All rows were filtered out before reaching drift_dedup", then a list of suspects ("postcode regex, price range, fuelcode mapping, etc."). It never picked postcode, the step Rhombus itself had flagged, and named the wrong file again (`Table 1 (1).csv`).
- **Fix:** the same as in schema-drift2, reset all 7 drift LLM steps to prompt mode ([screenshot](evidence/drift/12-schema-drift3-change-type-chatbot-resets-steps-to-prompt-mode.jpg)). The baseline wasn't touched.
- **Re-run** 00:23:26 → 00:24:46 (80 s): **success**, 2,367 rows (`0f899e3d…`). The new postcode code pulls the first 4 digits out of the value, so `NSW 2174` → `2174`.
- **But** compared with the baseline output, it has the same 2,363 rows plus 4 more. The source has four deliberately invalid postcodes (`NSW 29999`), which the baseline rule drops. The new code turns them into **`2999`**, a real-looking postcode that's wrong. The run is green and nothing warns.

My validator says FAIL either way: my rules expect 0 rows for this file, because `NSW 2174` isn't 4 digits. The useful comparison is against the baseline output, which shows the 4 fabricated rows.

## The schedule afterwards
#19863 (00:15) failed at Text Case, which was setup. **#19869 (00:20, 14.6 s) failed at Remove Duplicates**, the drift. **#19872 (00:25, 16.0 s) succeeded** with the chatbot's code and wrote the same 2,367 rows. The 00:30 run was **skipped**: "Skipped 1 time(s) in a row due to unchanged data" ([schedule card](evidence/drift/13-schema-drift3-change-type-schedule-skips-unchanged-data.jpg), [Executions](evidence/drift/14-schema-drift3-change-type-scheduled-runs-fail-then-succeed.jpg)). So it retries after failures but stops after a success until something changes.

## What I think
The pipeline did stop, and Rhombus did flag the right step, but on the canvas instead of in the error. The chatbot's fix is the worst outcome here: the pipeline goes green and quietly changes a rule, turning bad postcodes into plausible ones.

## Reproduce
Same as [schema-drift1](schema-drift1-drop-column.md#reproduce), with `Table 1 (3).csv`. Then compare the post-fix output with the baseline output: `diff <(sort baseline.csv) <(sort drift.csv)` shows the 4 `2999` rows.
