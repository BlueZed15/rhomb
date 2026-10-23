# <Case name, e.g. Schema drift: rename column>

> Copy this file to `observations/<case-id>.md`.
> Write **sections 1–2 before the run**, then sections 3–7 after ([D8](../docs/decisions.md#d8-predictions-written-before-each-drift-run)). The finished write-ups condense this into a shorter shape (see [README](README.md)).

| | |
|---|---|
| Case ID | `schema-drift2` (`schema-driftN` for schema drift, `semantic-driftN` for semantic) |
| Dataset | [`datasets/<file>.csv`](../datasets/) |
| S3 `VersionId` | |
| Pipeline state before run | baseline restored? (Y/N, how) |
| Run ID / scheduled time | |
| Severity | (see [rubric](../README.md#severity-rubric)) |

## 1. What changed
The exact change from the baseline: column, old value → new value, rows affected. Link to the generator code that produces it.

## 2. Prediction (written before the run)
- Will the platform stop, warn, or carry on?
- What will reach GCS?
- Why do I think so?

## 3. What happened (Observed)
Facts only. Give timestamps and link evidence.
- Run status:
- Did it stop, warn or carry on?
- What reached GCS (object name, row count, columns):
- The validation result goes in [`data-validation/results/<case>.json`](../data-validation/results/)

## 4. Logs
Did the logs explain the problem clearly? Quote the relevant lines.
```text
<log excerpt>
```
Evidence: [screenshot](evidence/<case>/01-logs.png)

## 5. Chatbot
- **Prompt given** (exact text):
  ```text
  ```
- Was the diagnosis correct, partly correct or wrong, and why?
- What fix did it suggest?
- Did the fix work when re-run? Link the evidence.

## 6. Schedule afterwards
Still active? Paused? Next run time? Did later runs succeed?

## 7. Interpretation
Kept separate from §3 on purpose. This section is my reasoning about **why**, and it's labelled as inference.
- Prediction vs. result:
- Likely cause:
- Customer impact:

## Reproduce
1. Restore the baseline pipeline by rebuilding it with [prompt 7](../docs/prompts/07-rebuild-before-schema-drift5.md) and check its output matches the baseline's sha256 ([D6](../docs/decisions.md#d6-every-drift-case-starts-from-the-same-verified-baseline)).
2. `python scripts/upload_dataset.py <case-file>` (puts it live at `input/fuelcheck.xlsx`, archives a numbered copy in `input/archive/`, logs it in `data-validation/runs.csv`).
3. Re-import the file by running `python scripts/presign_url.py input/fuelcheck.xlsx --copy`, then Data Input → From Web URL → paste → import → select the new table → Apply. That starts the run. The schedule won't pick up the change on its own ([D5](../docs/decisions.md#d5-drift-goes-in-by-overwriting-the-same-file)).
4. `python data-validation/validate.py datasets/<case-id>.csv <downloaded GCS file>`
