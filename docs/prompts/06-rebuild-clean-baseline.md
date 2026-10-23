# Prompt 6: rebuild the baseline in a clean project

Sent 2026-10-22 in the AI Builder with the **Pipeline** command, on Lattice, in the new project `fuelcheck-baseline` (workflow/5354), with Data Input = `Table 1.csv` (`input/archive/fuelcheck_0_baseline.xlsx` imported via From Web URL).

I used a new project because schema-drift2's chatbot fix changed the `drift1` pipeline, so schema-drift3 didn't start from the baseline. The spec wants each change tested on its own, so every case now starts from this one.

Same rules as [prompt 1](01-pipeline-cleaning.md). The only change is rule 1, which now says whitespace only and keep punctuation, because last time the builder picked a node that stripped all punctuation (see prompts 4–5).

```text
Build a cleaning pipeline for the dataset in the Data Input node (Table 1.csv, NSW fuel prices). Apply these rules in this order, one node per rule. 1) Whitespace only: trim leading/trailing spaces in every text column and collapse repeated spaces into one. Do NOT remove or change punctuation, letters, digits, dots or hyphens (261.9 must stay 261.9, 7-Eleven must stay 7-Eleven). 2) Drop rows where Price or FuelCode is empty. 3) Make FuelCode an upper-case code, mapping full names to codes: "Ethanol 94" -> E10, "Unleaded 91" -> U91, "Premium 95" -> P95, "Premium 98" -> P98, "Diesel" -> DL. Then drop rows whose FuelCode is not one of E10, U91, P95, P98, DL. 4) Brand: if a brand is written in ALL CAPS but the same brand appears elsewhere in normal case, use the normal-case spelling (e.g. 7-ELEVEN -> 7-Eleven). Brands that only ever appear in caps (e.g. BP) stay as they are. Do not merge different brands (Ampol, EG Ampol and Ampol Foodary are different brands). 5) Convert Suburb to Title Case. 6) Postcode: remove a trailing ".0", then drop rows where Postcode is not exactly 4 digits. 7) Price: remove a trailing "c", convert to a number, and drop rows where it is not a number or not between 100 and 400. 8) PriceUpdatedDate: output every value as DD/MM/YYYY HH:MM:SS. Some rows are in YYYY-MM-DD HH:MM:SS format and must be converted. 9) As the final step, remove exact duplicate rows. Keep all 8 columns with their current names and order; do not add or remove columns.
```

The builder first tried to add the nodes in two stages, couldn't wire stage 2 onto stage 1 ("the stage 1 nodes are all aliased as 'llm node'"), cleared the canvas itself and compiled all 9 in one go. It took 2m 22s. The node names are close to the old ones: `whitespace_trim`, `drop_empty_price_fuel`, `fuelcode_standardise`, `brand_normalise`, `suburb_title_case`, `postcode_clean`, `price_clean`, `date_format`, `dedup_final`.

Then the output, the same as [prompt 2](02-add-gcs-output.md), with the new dedup node name:

```text
Add a Data Output node at the end of the pipeline, connected after the final de-duplication node (dedup_final). It should export to the existing Google Cloud Storage destination named rhom-1, in CSV format. Do not change any of the existing cleaning nodes.
```

## Revert after schema-drift3
schema-drift3's chatbot rewrote `date_format`. Before schema-drift4 I asked the builder to put it back (Pipeline mode, Lattice):

```text
Undo your last change to the date_format node. Restore it to the original prompt and code from when you built the pipeline: PriceUpdatedDate is already parsed as datetime64 on import, so output every value as DD/MM/YYYY HH:MM:SS with .dt.strftime('%d/%m/%Y %H:%M:%S'). Make sure the code that runs is regenerated, not cached. Change no other node.
```
