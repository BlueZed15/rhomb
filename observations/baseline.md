# Baseline: the clean run everything else is compared against

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `baseline` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/baseline.json) |
| Input | `input/archive/fuelcheck_0_baseline.xlsx` (2,613 rows, about 17% deliberately messy; see [datasets/README](../datasets/README.md)) |
| Pipeline | Built by the AI builder only ([prompts](../docs/prompts/)), exported to GCS `rhom-1`, on a schedule |
| Result | **Passed.** The scheduled run at 06:30 wrote `RhombusAI_output_1792611024553.csv` (2,363 rows) |
| Severity | **Critical** (see the dates below), even though the run is green |

## Getting there
The S3 connector never worked ([write-up](setup-s3-source-connection.md)), so the source is a presigned S3 link through From Web URL ([D9](../docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)). The AI builder's first pipeline produced 0 rows, because it picked a "text cleanup" node that strips all punctuation (261.9 → 2619). Two "fixes" after that changed a node's prompt but not the code that runs. Prompt 5 finally sorted it. The builder also can't set a destination, so I picked `rhom-1` by hand.

## Did it pass?
Yes. The scheduled run succeeded, and it's **byte-identical** to the manual run 20 minutes earlier and to two later rebuilds of the same pipeline (sha256 `503fd6ed…`). So Rhombus is deterministic here, which makes every drift comparison fair.

## Is the output right?
Not quite. Compared with my answer key (the same 9 rules applied by [check_answer_key.py](../datasets/check_answer_key.py)):

| | Rows |
|---|---|
| Correct | 1,630 |
| **Date with day and month swapped** | **733** |
| Dropped instead of cleaned (`219.9c` prices) | 38 |

- **The 733 dates:** Rhombus guesses the type of each column when it imports a file, and it reads `08/09/2026` as **August 9**, not 8 September. Every date with a day of 12 or less got flipped, and the `date_format` node faithfully writes the wrong date back out. Nothing warns. For an Australian dataset that's the wrong default.
- **The 38 prices:** the same type guessing makes `Price` numeric, so `219.9c` becomes empty at import, and the "drop empty prices" step removes the row before the "strip the c" step ever sees it.

The spec only asks for a passing baseline, so I kept it as is and recorded these as **known baseline issues**. They're also why the drift cases compare against "the rules applied to the input" rather than a perfect answer.
