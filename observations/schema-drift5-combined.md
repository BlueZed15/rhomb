# schema-drift5 (Part 2) · All four at once

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift5` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/schema-drift5-combined.json) |
| Change | `Brand` dropped, `Price` → `PriceCentsPerLitre`, `Postcode` → `NSW 2174`, plus a new `IsDiscounted` column. |
| Pipeline before run | Rebuilt from the baseline input with [prompt 7](../docs/prompts/07-rebuild-before-schema-drift5.md). Its baseline output is byte-identical to the original (sha256 `503fd6ed…`). The builder made all 9 nodes LLM nodes (more below). |
| Stopped? | **At first yes, one error at a time. After the chatbot's second fix: no.** It "completed successfully" and wrote an **empty file** to GCS. |
| Reached GCS | **A header-only CSV, 0 rows**, with the drifted header (`PriceCentsPerLitre`, `IsDiscounted`, no `Brand`). |
| Chatbot fix worked? | **No.** It misdiagnosed both errors. Its last fix made the failure silent. |
| Severity | **Critical** (a run marked successful delivers an empty file) |

## What I expected (written before the run)
It should **stop at the first node that hits a problem**, which is node 2 (`Price` missing). The interesting part is that the error will only mention `Price`, not the other three changes. If I fix just that one, I'd then hit `Brand`, then the postcodes, one at a time.

## Before the run
schema-drift4's chatbot had swapped two built-in nodes for LLM nodes, so I put the input back to the baseline and asked the builder to rebuild. I asked for "built-in transformers where they fit". It ignored that and made **all 9 nodes LLM nodes, "to avoid the params-dropping issue"**, carrying over what it learned in schema-drift4. The output still matched the baseline byte for byte, so it's a fair starting point.

## What happened
**1. It stopped at node 2, as predicted, but with a worse error than schema-drift2** (16:38:27):
```text
Pipeline failed at drop_empty_price_fuel: LLM execution failed (code_sha=6fc3ee6e5526): 'Price' --- Generated code --- ...
```
Just a bare `'Price'` KeyError ([screenshot](evidence/drift/20-schema-drift5-fails-at-node2-bare-price-keyerror.jpg)). The rebuilt node no longer checks its columns, so you lose schema-drift2's clear "Column 'Price' does not exist".

**2. Chatbot, round 1: it looked at the wrong file.** It "Prepared Table 1.csv", the **old baseline**, not the selected `Table 1 (3).csv`. So it concluded "Price and FuelCode both exist" and blamed cached code. Its fix wrote the 8 column names into node 2's prompt and cleared the cache. The re-run got past node 2 and stopped at the next drift (16:40:39):
```text
Pipeline failed at brand_normalise: ... Column 'Brand' does not exist in output_df!
```
([screenshot](evidence/drift/21-schema-drift5-chatbot-fix-then-fails-at-brand.jpg))

**3. Chatbot, round 2: it hard-coded the old schema everywhere.** It called it "a recurring pattern", decided "upstream nodes may alter the DataFrame", and wrote the **old 8-column schema into all 9 node prompts**. It still never noticed that the file really has no `Brand` and no `Price`.

**4. Then it "succeeded" with nothing** (16:48:39). Every node ran. Two yellow "No results found" warnings appeared, and then:
> Pipeline completed successfully

([screenshot](evidence/drift/22-schema-drift5-empty-output-logged-as-success.jpg)) The file in GCS (`RhombusAI_output_1792648115554.csv`) is **101 bytes: a header and no rows.** The header shows the drift nobody caught: `...,Postcode,FuelCode,IsDiscounted,PriceUpdatedDate,PriceCentsPerLitre`.

**5. The "fixed" pipeline no longer runs on the original data.** Before semantic-drift1, I pointed it back at the baseline file to check it was still clean (17:42:24):
```text
Pipeline failed at drop_empty_price_fuel: ... Column 'IsDiscounted' does not exist in input_df_1!
```
([screenshot](evidence/drift/23-schema-drift5-fixed-pipeline-now-fails-on-baseline.jpg)) The chatbot's fixes had tuned node 2 to the drifted file. So "fixing" for the drift broke the pipeline for the normal input, and I had to rebuild it.

## The logs
- The errors came one at a time, exactly as predicted. Each names a single column, so you can't tell it's four changes at once.
- The final run is green, with "completed successfully" next to two yellow "No results found" warnings. The warnings don't even name the nodes in the log list.

## The chatbot
- The diagnosis was **wrong both times**. First it inspected the wrong dataset (the baseline, not the one selected). Then it blamed upstream nodes. It never compared the actual columns to the expected ones.
- The fix **made things worse**. Each fix only exposed the next error, the last one turned a loud failure into a "successful" run that writes an empty file, and the result no longer works on the original data either.

## The schedule afterwards
This project has no schedule. On `drift1` the schedule skips on "unchanged data" and never sees any of this. Here a scheduled run would have *succeeded*, and downstream would get an empty file with no alert.

## What I think
This is the worst result so far. The prediction held. It failed one error at a time, and none of them showed the whole picture. But the chatbot's "fixes" were aimed at making the error go away, not at the data, and they got there. A loud stop became a silent empty file marked as success. Only my validator says something's wrong: 0 rows, `Brand` and `Price` missing, two unknown columns.

## Reproduce
1. `python scripts/upload_dataset.py schema-drift5-combined`
2. Rebuild on the baseline with prompt 7, then import a fresh link (`python scripts/presign_url.py input/fuelcheck.xlsx --copy`, then Data Input → From Web URL) → select the new table (`Table 1 (3).csv` for me) → Apply.
3. Logs → Ask Chatbot on each error → Run.
4. `python data-validation/validate.py datasets/schema-drift5-combined.csv <downloaded output.csv>`
