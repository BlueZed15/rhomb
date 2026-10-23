# semantic-drift1 (Part 3) · Prices in dollars instead of cents

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `semantic-drift1` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/semantic-drift1-cents-to-dollars.json) |
| Change | `Price` is divided by 100 (`253.9` → `2.539`). Same column, same type, so nothing structural changes. |
| Pipeline before run | Rebuilt on the baseline input with [prompt 7](../docs/prompts/07-rebuild-before-schema-drift5.md). Its output is byte-identical to the original baseline (sha256 `503fd6ed…`). |
| Does Rhombus notice? | **Barely.** One yellow popup, "price_clean: No results found", and then **"Pipeline completed successfully"**. |
| Reached GCS | **A header-only CSV, 0 rows** (`RhombusAI_output_1792655964376.csv`, 81 bytes). |
| Does our validation catch it? | **Yes, on row count** (0 out, 38 expected, 2,401 normally). The semantic checks had no rows to look at. |
| Severity | **Critical** (all the data silently gone, run marked as a success) |

## What I expected (written before the run)
Rhombus has no idea what the numbers mean, so on its own it wouldn't notice. But my `price_clean` rule keeps only 100–400, so I expect **every row to be dropped** and the run to fail with "DataFrame should not be empty". In other words, it gets "caught" only by accident, because of my rule, and the error won't say anything about units. My validator should flag it either way, because the output is empty or every price is outside its fuel's band.

## What happened
Half right. `price_clean` did drop every row (18:57:35), and Rhombus showed a yellow popup ([screenshot](evidence/drift/24-semantic-drift1-price-clean-no-results.jpg)):
> price_clean: No results found after applying this LLM transformation.

But it **didn't fail**. The pipeline I rebuilt before schema-drift5 uses an LLM node for dedup (the builder now avoids the built-in ones), and that node doesn't check for an empty table. So the run went all the way through (18:59:27) ([screenshot](evidence/drift/25-semantic-drift1-success-despite-no-results.jpg)):
> Pipeline completed successfully

and wrote a CSV with only the header to GCS.

The popup says nothing about units or prices being 100× too small. It's the same generic "No results" you'd get from any over-strict filter.

## What our validation says
- **0 rows out vs 38 expected.** That alone flags it.
- Why 38 and not 0: those are the rows with prices like `219.9c`, which the drift script left as text, so they still read as cents. Rhombus drops them at import anyway (it types `Price` as numeric), same as the baseline.
- The semantic checks (price band per fuel, median price) had **nothing to look at**, because the output is empty. They would have caught it if the price filter weren't there. A fuel at $2.54 is miles outside its band.

## The chatbot
Nothing failed, so there was no error to give it. On this drift, Rhombus gives you nothing to act on.

## The schedule afterwards
This project has no schedule. On a scheduled pipeline this run would just be a green tick, with an empty file downstream.

## What I think
My guess was the run would fail by accident. It didn't even do that. The only reason the data didn't go through *wrong* is my 100–400 filter, and the only reason anyone would notice is that the file is empty. Rhombus never mentions units, and it calls a run that delivers nothing a success. A row-count check (or a "0 rows written" alert) would be the cheapest fix on their side.

## Reproduce
1. `python scripts/upload_dataset.py semantic-drift1-cents-to-dollars`
2. Rebuild on the baseline with prompt 7, then import a fresh link (`python scripts/presign_url.py input/fuelcheck.xlsx --copy`, then Data Input → From Web URL) → select the new table (`Table 1 (4).csv` for me) → Apply.
3. `python data-validation/validate.py datasets/semantic-drift1-cents-to-dollars.csv <downloaded output.csv>`
