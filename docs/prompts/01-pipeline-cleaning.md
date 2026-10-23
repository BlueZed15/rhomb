# Prompt 1: build the cleaning pipeline

Sent 2026-10-22 in the AI Builder with the **Pipeline** command, on project `drift1`, with Data Input = `Table 1.csv` (`baseline.xlsx` imported via From Web URL). The rules come from [datasets/README.md](../../datasets/README.md#cleaning-rules).

```text
Build a cleaning pipeline for the dataset in the Data Input node (Table 1.csv, NSW fuel prices). Apply these rules in this order. 1) Trim leading/trailing whitespace in every column and collapse repeated spaces into one. 2) Drop rows where Price or FuelCode is empty. 3) Make FuelCode an upper-case code, mapping full names to codes: "Ethanol 94" -> E10, "Unleaded 91" -> U91, "Premium 95" -> P95, "Premium 98" -> P98, "Diesel" -> DL. Then drop rows whose FuelCode is not one of E10, U91, P95, P98, DL. 4) Brand: if a brand is written in ALL CAPS but the same brand appears elsewhere in normal case, use the normal-case spelling (e.g. 7-ELEVEN -> 7-Eleven). Brands that only ever appear in caps (e.g. BP) stay as they are. Do not merge different brands (Ampol, EG Ampol and Ampol Foodary are different brands). 5) Convert Suburb to Title Case. 6) Postcode: remove a trailing ".0", then drop rows where Postcode is not exactly 4 digits. 7) Price: remove a trailing "c", convert to a number, and drop rows where it is not a number or not between 100 and 400. 8) PriceUpdatedDate: output every value as DD/MM/YYYY HH:MM:SS. Some rows are in YYYY-MM-DD HH:MM:SS format and must be converted. 9) As the final step, remove exact duplicate rows. Keep all 8 columns with their current names and order; do not add or remove columns.
```

It's one paragraph because pressing Enter sends the message.
