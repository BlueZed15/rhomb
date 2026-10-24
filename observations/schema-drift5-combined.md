# schema-drift5 (Part 2) · All four schema changes at once

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift5` · [validation](../data-validation/results/schema-drift5-combined.json) |
| Input | [`datasets/schema-drift5-combined.csv`](../datasets/), `Table 1 (5).csv` in Rhombus |
| Change | `Brand` dropped, `Price` → `PriceCentsPerLitre`, `Postcode` → `NSW 2174`, new `IsDiscounted` |
| Drift pipeline before run | Reset to the baseline, pre-check `503fd6ed…` (00:52:12) |
| Stopped? | **Yes**, at `drift_drop_empty`, on the first missing column only |
| Reached GCS | Nothing |
| Chatbot fix worked? | **No.** Wrong diagnosis; it "fully replaced" 6 nodes and the same code still ran |
| Severity | **Medium** |

## What I expected (written before the run)
It stops at the first step that needs a missing column (`drop_empty`, `Price`), reporting one error at a time.

## What happened
The input switch at 00:53:39 failed straight away at `drift_drop_empty`, before the wiped built-ins, so this failure is the drift itself. With everything back on baseline values, the run at 00:56:35 failed at 00:56:54:

```text
Pipeline failed at drift_drop_empty: LLM execution failed (code_sha=b84404c094a4): Column 'Price' does not exist in input_df_1!
```
([screenshot](evidence/drift/17-schema-drift5-combined-fails-price-missing.jpg)). It's the same `code_sha` as schema-drift2. Nothing reached GCS. Validator: FAIL, no output; it lists all four changes.

**Repeats (consistency):** 3 more runs at 07:23–07:24 on 24 Oct all failed at `drift_drop_empty` with `code_sha=b84404c094a4` ([screenshot](evidence/drift/26-schema-drift5-combined-repeat-runs-same-failure.jpg), [consistency.csv](../data-validation/consistency.csv)).

## The logs
Accurate for the first problem only. Nothing hints that `Brand` is gone too, or that `Postcode` changed.

## The chatbot
Lattice, 00:57:54 (about 1 min 20 s).
- **Diagnosis: wrong.** "Table 1 (1).csv has different column names… 'Price' may be cased differently." That's the wrong file again. Price was renamed, and three other things changed too.
- **Fix:** it patched 7 nodes, then said the patch "didn't take effect" and used `add_node` to **fully replace** 6 drift LLM steps with new prompts ("First, discover the actual column names… case-insensitively matches 'Price'…") ([screenshot](evidence/drift/18-schema-drift5-combined-chatbot-replaces-drift-nodes.jpg)). The baseline wasn't touched.
- **Re-run** 01:01:16 → 01:01:40: **the same error and the same `code_sha=b84404c094a4`** ([screenshot](evidence/drift/19-schema-drift5-combined-rerun-same-error-same-code-sha.jpg)). Afterwards the API showed the steps with the chatbot's new prompts, but in code mode and running the original code byte for byte. The "replacement" changed the text, not what runs.

## The schedule afterwards
- #19903 (00:55) failed at `drift_drop_empty`.
- **#19906 (01:00:25, 1 min 8 s)** ran right after the chatbot's change. It wrote new code, passed all 14 LLM steps, and failed at Remove Duplicates (no `Price`).
- A minute later my manual run used the original code again.
- #19911 (01:05) failed at `drift_drop_empty` once more ([screenshot](evidence/drift/20-schema-drift5-combined-scheduled-runs.jpg)).

So a scheduled run and a manual run, a minute apart, ran different code.

## What I think
Rhombus stops on the first problem and never shows the others, so a customer would fix one, re-run, and find the next. The chatbot claimed a fix that didn't change what runs, which is the same as schema-drift1. And the 01:00 run shows the code that runs can depend on whether the run was scheduled or manual.

## Reproduce
Same as [schema-drift1](schema-drift1-drop-column.md#reproduce), with `Table 1 (5).csv`. After the chatbot's fix, read the step through the API: prompt changed, code unchanged.
