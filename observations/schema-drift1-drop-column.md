# schema-drift1 (Part 2) · Drop a column (`Brand`)

> Terms: see the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift1` · [validation](../data-validation/results/schema-drift1-drop-column.json) |
| Input | [`datasets/schema-drift1-drop-column.csv`](../datasets/), `Table 1 (1).csv` in Rhombus |
| Change | `Brand` removed. Everything else matches the baseline. |
| Drift pipeline before run | Reset to the baseline, pre-check output `503fd6ed…` (20:48) |
| Stopped? | **Yes**, at `drift_brand_normalise` |
| Reached GCS | Nothing |
| Chatbot fix worked? | **No.** Wrong diagnosis, and its edit landed on the **baseline** pipeline |
| Severity | **Medium** |

## What I expected (written 20:47, before the run)
It stops at the brand step with a missing-column error naming `Brand`, and nothing reaches GCS. I guessed the chatbot would suggest skipping `Brand` when it's missing.

## What happened
I switched the drift input to `Table 1 (1).csv` at 20:49:21. The run failed 14 s later:

```text
Pipeline failed at drift_brand_normalise: LLM execution failed (code_sha=4d71fab9718a): 'Brand'
Pipeline execution completed successfully.
```
([screenshot](evidence/drift/01-schema-drift1-fails-at-brand-step.jpg)). Nothing reached GCS. My validator: FAIL, no output, `Brand` missing from the input.

**Repeats (consistency):** 3 more runs at 07:20–07:21 on 24 Oct all failed the same way, at `drift_brand_normalise` with `code_sha=4d71fab9718a` ([consistency.csv](../data-validation/consistency.csv)).

## The logs
Right node, but the error is a bare Python `KeyError: 'Brand'`. It doesn't say "column missing", and "completed successfully" is logged in the same second.

## The chatbot
Ask Chatbot on the error, Lattice, 20:50:20 (1 min 21 s).
- **Diagnosis: wrong.** It said `Brand` has nulls. The column isn't there at all.
- **Fix:** it rewrote the prompt of `drift_brand_normalise` **and of `base_brand_normalise`**, the baseline step I'd told the builder never to touch, and set both to regenerate ([screenshot](evidence/drift/02-schema-drift1-chatbot-blames-nulls-and-edits-baseline.jpg)).
- **Re-run** 20:52:34: the same error with the **same `code_sha=4d71fab9718a`** ([screenshot](evidence/drift/03-schema-drift1-rerun-same-error-same-code-sha.jpg)). The API showed why: the drift step was unchanged, and only the baseline step had been edited.

I restored the baseline step at 22:50. Its two scheduled outputs in between (21:00 and 22:00) were still `503fd6ed…`, so the change happened not to alter its output.

## The schedule afterwards
It kept running every 5 minutes and recorded every failure: Executions #19768 (21:15) to #19788 (22:00), all Failure ([screenshot](evidence/drift/04-schema-drift1-scheduled-runs-all-fail.jpg)). After 22:00 it stopped, and the card showed **Inactive** at 22:52 without me touching it ([screenshot](evidence/drift/05-schema-drift1-schedule-turned-inactive.jpg)). No notification reached me.

## What I think
The pipeline did the right thing and stopped. The worry is the chatbot: it edited the one pipeline it had no reason to touch, and its fix didn't change the code that runs. If the baseline had been the customer's production pipeline, a "fix" for a test copy would have changed it.

## Reproduce
1. Reset the drift pipeline: switch `drift_input` to `Table 1.csv`, paste the baseline code into any changed `drift_` step, set Text Case (Suburb, Title), Remove Duplicates (8 columns, keep first) and the output (`rhom-1`, `fuelcheck-<case>`). The pre-check output must be `503fd6ed…`.
2. Switch `drift_input` to `Table 1 (1).csv` (this starts a run).
3. Logs → Ask Chatbot → let it apply → ▶.
4. `python data-validation/validate.py datasets/schema-drift1-drop-column.csv --no-output --name schema-drift1-drop-column`
