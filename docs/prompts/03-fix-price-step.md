# Prompt 3: fix the price step

Sent 2026-10-22 with the **Pipeline** command, model **Lattice (Opus 4.6, medium)**. The first run failed and the price step was dropping every row, so I gave the AI builder the exact error, the way a customer would.

```text
When I run the pipeline it fails with: "Pipeline failed at deduped_output: DataFrame should not be empty." Before running, the canvas also warned "price_clean: No results found after applying this LLM transformation" and "date_format: No results found after applying this filter". Please fix the price step so it does what rule 7 asked: remove a trailing "c", convert Price to a number, and keep only rows where Price is between 100 and 400 (cents per litre, so most real prices are around 190-280 and should be kept). Make sure rows flow through to the output, and don't change the other cleaning steps unless they are also broken.
```
