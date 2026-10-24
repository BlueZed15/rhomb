# schema-drift2 (Part 2) · Rename a column (`Price` → `PriceCentsPerLitre`)

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift2` · [validation](../data-validation/results/schema-drift2-rename-column.json) |
| Input | [`datasets/schema-drift2-rename-column.csv`](../datasets/), `Table 1 (2).csv` in Rhombus |
| Change | `Price` renamed to `PriceCentsPerLitre`. Values unchanged. |
| Drift pipeline before run | Reset to the baseline, pre-check `503fd6ed…` (23:02:43) |
| Stopped? | **Yes**, at `drift_drop_empty`, with a clear error |
| Reached GCS | Nothing |
| Chatbot fix worked? | **No.** It moved the failure to dedup, and broke the step for the original file |
| Severity | **Medium** |

## What I expected (written before the run)
It stops at the first step that reads `Price` (`drop_empty`), and nothing reaches GCS.

## What happened
Input switched 23:03:32; failed at 23:03:50:

```text
Pipeline failed at drift_drop_empty: LLM execution failed (code_sha=b84404c094a4): Column 'Price' does not exist in input_df_1!
```
([screenshot](evidence/drift/06-schema-drift2-fails-price-missing.jpg)). Nothing reached GCS. Validator: FAIL, no output; `Price` removed, `PriceCentsPerLitre` added.

**Repeats (consistency):** 3 more runs at 07:21–07:23 on 24 Oct all failed at `drift_drop_empty` with `code_sha=b84404c094a4` ([consistency.csv](../data-validation/consistency.csv)).

## The logs
Clear: right node, right column. It doesn't mention that a similar column appeared.

## The chatbot
Lattice, 23:06:18. (A reload had emptied the Logs, so I re-ran once at 23:05:34 to get the Ask Chatbot button back.)
- **Diagnosis: partly right.** "Different column names", but it named the wrong file (`Table 1 (1).csv`) and guessed casing or spacing. It never spotted the rename.
- **Fix:** reset all 7 drift LLM steps to prompt mode so the code is rewritten ([screenshot](evidence/drift/07-schema-drift2-chatbot-resets-steps-to-prompt-mode.jpg)).
- **Re-run** 23:08:46 → 23:10:25 (99 s, code rewritten): every LLM step passed, then it stopped at `drift_dedup` ([screenshot](evidence/drift/08-schema-drift2-rerun-passes-llm-steps.jpg)). Remove Duplicates is set to the baseline's 8 columns, including `Price`, which this file doesn't have. Re-pointing it to `PriceCentsPerLitre` would be my fix, not the chatbot's ([D11](../docs/decisions.md#d11-a-strict-rule-for-did-the-chatbots-fix-work)).
- **Worse:** the rewritten code hard-codes `PriceCentsPerLitre`, though the prompt still says `Price`. When I reset the input to `Table 1.csv` at 23:24:59, `drift_drop_empty` failed on the **original** file. The fix moved the break instead of fixing it.

## The schedule afterwards
Still Active and still recording failures: #19819 (23:15:18, 19.8 s) and #19823 (23:20) both failed at Remove Duplicates ([screenshot](evidence/drift/09-schema-drift2-scheduled-run-fails-at-dedup.jpg)). The baseline's nodes completed in the same executions.

## What I think
A rename is handled as well as it can be: a loud, accurate error. The chatbot's "rewrite the code" fix fits the code to whatever file is loaded at the time, so it breaks as soon as the original comes back. For a scheduled pipeline that's a trap.

## Reproduce
Same as [schema-drift1](schema-drift1-drop-column.md#reproduce), with `Table 1 (2).csv` and `datasets/schema-drift2-rename-column.csv`.
