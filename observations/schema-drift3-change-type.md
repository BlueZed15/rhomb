# schema-drift3 (Part 2) · Change a type (`Postcode` 2174 → `NSW 2174`)

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift3` ([runs.csv](../data-validation/runs.csv), two rows: first attempt and clean re-run) · [validation](../data-validation/results/schema-drift3-change-type.json) |
| Change | `Postcode` goes from a number to text with a state prefix. |
| Pipeline before run | **Clean re-run:** the baseline, rebuilt in a fresh project (`fuelcheck-baseline`) from [prompt 6](../docs/prompts/06-rebuild-clean-baseline.md). Its output is byte-identical to the original baseline. The first attempt ran on `drift1` after schema-drift2's chatbot edits; it's kept below because it went the same way. |
| Stopped? | **Yes, but late and in the wrong place.** `postcode_clean` drops every row, and the run fails two nodes later at dedup. Before that, it fails on two built-in nodes that lost their settings when I switched the input. |
| Reached GCS | Nothing |
| Chatbot fix worked? | **Partly.** It re-filled the wiped nodes, but it blamed the wrong node for the real problem, and that fix didn't work. |
| Severity | **High** (it stops, but the error points at the wrong node and the chatbot can't find the real cause) |

## What I expected (written before the run)
Nothing checks the type, so I don't expect an error at first. `postcode_clean` keeps only exactly-4-digit postcodes, so it should **quietly drop every row**, and the run then fails later at dedup with the vague "DataFrame should not be empty". If that's what happens, the error points at the wrong node, the same way the price warning did when I built the baseline.

## What happened (clean re-run, 15:29–15:37)
**1. Switching the input broke two built-in nodes.** Selecting the new table started a run, which failed straight away:
```text
Pipeline failed at suburb_title_case: DataframeTextCaseTransform.transform() missing 1 required positional argument: 'columns'
```
The Text Case node had no target column and was set to **UPPER** ([screenshot](evidence/drift/13-schema-drift3-clean-suburb-wiped-on-input-switch.jpg)). The same pipeline had passed on the baseline input two minutes earlier, and nothing else touched it. So it's the input switch itself that wipes the settings of Rhombus's own (non-LLM) nodes. I only see it now because schema-drift1 and schema-drift2 failed before reaching node 5.

**2. The chatbot re-filled them, one error at a time.** It said the "params are empty — the columns parameter wasn't persisted" and patched the suburb node ([screenshot](evidence/drift/14-schema-drift3-clean-chatbot-patches-suburb.jpg)). The next run failed at `dedup_final` with the same missing `columns`, and one more prompt fixed that. It never said *why* the settings disappeared, or that the next built-in node would have the same problem.

**3. Then the actual drift, exactly as predicted.** A yellow popup:
> postcode_clean: No results found after applying this LLM transformation.

(and the same for `price_clean`, which had nothing left to filter) ([screenshot](evidence/drift/15-schema-drift3-clean-postcode-price-no-results.jpg)). The run ended with:
```text
Pipeline failed at dedup_final: DataFrame should not be empty.
```
([screenshot](evidence/drift/16-schema-drift3-clean-empty-dataframe-at-dedup.jpg)) Nothing reached GCS. `NSW 2174` isn't 4 digits, so every row went. My validator agrees: the expected output under our rules is empty.

## The logs
- The real cause is only in the **yellow popup** ("No results found… postcode_clean"). The red error names `dedup_final`, two nodes later, with a generic message that doesn't mention postcodes.
- Every failure is still paired with "Pipeline execution completed successfully" in the same second.

## The chatbot (on the real error)
I sent "DataFrame should not be empty" with Ask Chatbot, on Lattice.
- The diagnosis was **wrong**. It said "An upstream node is likely dropping too many rows" (good start), then decided the **root cause** was `date_format` calling `.dt.strftime()` on a string ([screenshot](evidence/drift/17-schema-drift3-clean-chatbot-blames-date-format.jpg)). That's not it. The date node works fine on the baseline, and the postcode warning was on screen the whole time.
- For the fix, it rewrote `date_format`'s prompt to handle string dates.
- **Did it work? No.** The re-run at 15:37:43 failed with the same error, and the postcode warning came back ([screenshot](evidence/drift/18-schema-drift3-clean-fix-fails-postcode-warning-again.jpg)).

## The schedule afterwards
This clean project has no schedule. In the first attempt on `drift1`, the schedule stayed **Active**, kept skipping with "unchanged data", and none of the failures showed up in its history (same as schema-drift1 and schema-drift2).

## What I think
The drift behaves exactly as predicted: a silent "drop everything" step, then a vague error two nodes downstream. On a clean pipeline with no history to confuse it, the chatbot still went for the wrong node and confidently called it the root cause. It never connected the error to the warning Rhombus itself showed. The bigger surprise is step 1: **just pointing the pipeline at a new file wipes the built-in nodes' settings.** For any scheduled pipeline whose source changes, that turns every refresh into a break.

## First attempt (on `drift1`, not from a clean baseline)
Kept for the record. It went the same way: the suburb node failed with a wiped config, then dedup, then "DataFrame should not be empty" ([screenshots 06–12](evidence/drift/)). At the time I blamed schema-drift2's chatbot fix for wiping the nodes. **The clean re-run shows that was wrong:** the input switch does it. The chatbot's diagnosis there was worse still. It reused schema-drift2's conversation, decided the pipeline needed `PriceCentsPerLitre` (a column this file doesn't have), and its fix failed. It did admit "The cached code runs instead of regenerating from the updated prompt", which explains why its earlier fixes never changed the `code_sha`.

## Reproduce
1. `python scripts/upload_dataset.py schema-drift3-change-type`
2. In the baseline project: Data Input → From Web URL → paste the link from `python scripts/presign_url.py input/fuelcheck.xlsx --copy` → import → select the new table → Apply (this starts a run).
3. Logs → Ask Chatbot on each failure → Run.
4. `python data-validation/validate.py datasets/schema-drift3-change-type.csv --no-output` (the run wrote nothing)
