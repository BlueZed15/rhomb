# datasets/

Real NSW fuel prices with mess added on purpose, plus a drifted version for each test case. Why I picked this data is in [D10](../docs/decisions.md#d10-nsw-fuelcheck-fuel-prices-as-the-dataset).

The source is [NSW FuelCheck price history, September 2026](https://data.nsw.gov.au/data/dataset/fuel-check), © NSW Fair Trading via Data.NSW, licensed **CC BY-SA**. The files here are adapted from it and shared under the same licence.

## Where it came from and what I found
- **Where:** Data.NSW → FuelCheck → resource "FuelCheck Price History September 2026", file [`fuelcheck_pricehistory_sep2026.xlsx`](https://data.nsw.gov.au/data/dataset/a97a46fc-2bdd-4b90-ac7f-0cb1e8d7ac3b/resource/bb8f9fe7-17ab-4354-984f-d18dccfd8dcf/download/fuelcheck_pricehistory_sep2026.xlsx) (6.6 MB). I found it through the Data.NSW API on 2026-10-22. There are monthly files back to 2016.
- **Shape:** 146,308 price updates from 2,339 stations and 62 brands, covering 1–30 September 2026. There are 8 columns: `ServiceStationName, Address, Suburb, Postcode, Brand, FuelCode, PriceUpdatedDate, Price`.
- **Price** is in cents per litre: median 242, range 94–300. LPG is much cheaper (about 112). There are no missing values and no duplicate rows.
- **Real quirks** include 3 lines of report metadata above the header. Suburbs about half ALL CAPS. Ampol appears five different ways. 21 stations spell their own suburb two ways. 45 addresses have quoted highway names (`"Mitchell Highway"`). Barooga's postcode is 3644.
- **Excel to CSV** was clean, with one sheet, no merged cells, no hidden rows, no formulas, no footer. The colours are just header and row shading, which CSV drops anyway. Postcode is stored as text, so I read it as text (pandas would otherwise turn it into a number and drop leading zeros). I compared every one of the 1.17M cells against the workbook after the round trip, and none differed.

```bash
python datasets/generate.py
```
It downloads the source into `raw/` (gitignored), takes a seeded sample of 2,500 price updates for E10, U91, P95, P98 and diesel, and writes everything below. Running it again gives byte-identical files.

## Files
| File | What it is |
|---|---|
| `baseline.csv` | The messy input: 2,613 rows |
| `baseline_expected.csv` | The answer key, i.e. what clean output should be: 2,401 rows |
| `baseline_manifest.json` | Exactly which rows I broke and how |
| `schema-drift*.csv`, `semantic-drift*.csv` | Drift versions of `baseline.csv` (see below): schema drift is Part 2 of the brief, semantic drift is Part 3 |
| `check_answer_key.py` | Applies the rules below to `baseline.csv` and checks the result against the answer key |
| `xlsx/*.xlsx` | The same files saved as Excel, all columns as text. This is what Rhombus imports, because its From Web URL import rejected CSV ([D9](../docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)) |

## Cleaning rules
These are what I give the AI builder, and what the validator checks. `python datasets/check_answer_key.py` applies them to `baseline.csv` and confirms they produce `baseline_expected.csv` exactly.

1. Trim whitespace in every column, and collapse double spaces.
2. Drop rows with no `Price` or no `FuelCode`.
3. Make `FuelCode` an upper-case code, turning full names into codes (`Unleaded 91` → `U91`, `Diesel` → `DL`). Drop anything that isn't E10, U91, P95, P98 or DL.
4. Fix `Brand` written in ALL CAPS to the normal spelling used elsewhere in the file (`7-ELEVEN` → `7-Eleven`). Brands that are always caps, like `BP`, stay as they are. Don't merge different brands: `Ampol`, `EG Ampol` and `Ampol Foodary` really are different store formats.
5. Make `Suburb` Title Case.
6. Remove a trailing `.0` from `Postcode`, then drop rows where it isn't exactly 4 digits.
7. Make `Price` a number (strip a trailing `c`), and drop rows where it isn't between 100 and 400 cents per litre.
8. Write every `PriceUpdatedDate` as `DD/MM/YYYY HH:MM:SS` (some rows arrive as `YYYY-MM-DD`).
9. Remove duplicate rows **last**, so rows that only match once they're cleaned get caught too.

Things the real data taught me:
- **Not every NSW postcode starts with 2.** Barooga is a NSW border town with postcode 3644. My first rule ("2xxx only") would have wrongly dropped it.
- **LPG is cheap** (about 112 c/L), so one price range for every fuel would flag it as bad. I left LPG out of the sample to keep the price checks simple.
- **"Use the most common spelling" isn't safe** for rare brands. In this sample, the caps copies of "IOR Group" outnumber the real spelling, which is why rule 4 prefers the normal-case spelling instead.

## The mess I added
About 17% of rows ([manifest](baseline_manifest.json)). The real data already brings mixed ALL CAPS and Title Case suburbs.

| Problem | Rows | After cleaning |
|---|---|---|
| Brand in caps with extra spaces (`  BP `) | 50 | fixed |
| FuelCode in lower case / as a full name (`Premium 98`) | 38 / 30 | fixed |
| Price with a unit (`201.9c`) | 38 | fixed |
| Postcode as an Excel number (`2174.0`) | 30 | fixed |
| Date in ISO format (`2026-09-17 07:09:15`) | 38 | fixed |
| Double space in station name | 25 | fixed |
| Missing price / missing fuel code | 25 / 12 | dropped |
| Price 0 or negative / `N/A` | 15 / 10 | dropped |
| Price with a slipped decimal (`2539.0`, `25.39`) | 15 | dropped |
| Bad postcode (`999`, `20O0`, `29999`) | 12 | dropped |
| Unknown fuel code (`XYZ`) | 10 | dropped |
| Exact duplicate rows | 75 extra | dropped |
| Near-duplicates (only differ in case or spacing) | 38 extra | dropped by rule 9 |

## Drift cases
Each one is `baseline.csv` with a single change (except "combined"), imported into Rhombus once each ([D5](../docs/decisions.md#d5-each-drift-file-is-its-own-import-and-a-case-switches-the-input)).

| File | Change |
|---|---|
| `schema-drift1-drop-column.csv` | `Brand` removed |
| `schema-drift2-rename-column.csv` | `Price` → `PriceCentsPerLitre` |
| `schema-drift3-change-type.csv` | `Postcode` becomes text: `2174` → `NSW 2174` |
| `schema-drift4-add-column.csv` | New `IsDiscounted` (Y/N) column |
| `schema-drift5-combined.csv` | All four at once |
| `semantic-drift1-cents-to-dollars.csv` | Price in dollars instead of cents: `253.9` → `2.539` |
| `semantic-drift2-date-mmdd.csv` | Dates written US-style: `17/09/2026` → `09/17/2026` |

The two semantic files keep the same columns, so only the values give the drift away. Prices should sit around 200–300 c/L, so 2.5 stands out, and if the AI builder applies rule 7 faithfully, every row gets dropped. With dates swapped, 1,694 rows become impossible (month 13+) and 828 land outside September. The 91 rows dated 9 September read the same either way, so they can't be caught, but they aren't wrong either.
