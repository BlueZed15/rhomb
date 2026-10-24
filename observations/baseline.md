# Baseline: the clean run everything else is compared against

> New to the terms here (`code_sha`, LLM node, drift pipeline…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `baseline` · [validation](../data-validation/results/baseline.json) · [every repeat run](../data-validation/consistency.csv) |
| Input | [`datasets/baseline.csv`](../datasets/), imported into Rhombus as `Table 1.csv` (2,613 rows, about 17% deliberately messy; see [datasets/README](../datasets/README.md)) |
| Pipeline | Built by the AI builder from one prompt ([prompt 6](../docs/prompts/06-baseline-pipeline.md)) in project `fuelcheck-drift`, exported to GCS `rhom-1`, on a 5-minute schedule |
| Result | **Passed.** 2,363 rows, sha256 `503fd6ed…`, and the same file every time |
| Severity | **Critical** (see the dates below), even though the run is green |

## Getting there
One builder prompt on 2026-10-23 18:07 (Lattice, 2 min 3 s) gave an 11-node pipeline: 7 LLM steps, Text Case, Remove Duplicates, input and output ([left half](evidence/baseline/01-baseline-pipeline-left.jpg), [right half](evidence/baseline/02-baseline-pipeline-right.jpg)). The builder saved the destination as a name it couldn't resolve, so I picked `rhom-1` by hand.

- First run 18:13:25 → 18:15:09 (104 s, most of it Rhombus writing each step's code). Output `fuelcheck-baseline_1792739703234.csv`, now kept in GCS as `rhom-1/baseline/baseline-output.csv`.
- Schedule `*/5 * * * *` created 18:30:36. The first scheduled run, Execution #19672 at 18:35:11, took 11.6 s and succeeded ([screenshot](evidence/baseline/03-first-scheduled-run-success.jpg)).

The S3 connector never worked ([write-up](setup-s3-source-connection.md)), so the file comes in through a presigned S3 link ([D9](../docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)).

## The drift copy
The drift cases run on a second pipeline on the same canvas: an exact copy of this one. I asked the builder for the copy ([prompt 7](../docs/prompts/07-drift-copy.md)). It copied the prompts but not the code, because Rhombus writes the code on the first run and the builder can't set it. It also rewrote all seven baseline LLM steps and the baseline output, which I'd told it not to touch. So I restored the baseline from a saved snapshot and pasted the code into the copy by hand. At 20:44:58 both pipelines wrote byte-identical files.

## Did it pass?
Yes, and it's deterministic. Every baseline-pipeline output I downloaded, plus every pre-check of the drift copy before each case, is byte-identical: 16 files, all `503fd6ed…` ([consistency.csv](../data-validation/consistency.csv)). That includes two scheduled baseline outputs (21:00, 22:00) written while the schema-drift1 chatbot had changed the baseline's brand step, so that change happened not to affect the output.

## Is the output right?
Not quite. Compared with my answer key (the same 9 rules applied by [check_answer_key.py](../datasets/check_answer_key.py)):

| | Rows |
|---|---|
| Correct | 1,630 |
| **Date with day and month swapped** | **733** |
| Dropped instead of cleaned (`219.9c` prices) | 38 |

- **The 733 dates:** Rhombus guesses each column's type when it imports a file, and reads `08/09/2026` as August 9, not 8 September. Every date with a day of 12 or less gets flipped, and the date step writes the wrong date back out. Nothing warns.
- **The 38 prices:** the same guessing makes `Price` numeric, so `219.9c` is empty after import and the "drop empty prices" step removes the row before the "strip the c" step sees it.

The brief only asks for a passing baseline, so I kept it and recorded these as known baseline issues. They're why the drift cases compare against the baseline output as well as my rules.

## Reproduce
1. Set up the bucket, the GCS destination and the project ([docs/setup/](../docs/setup/)), then import the inputs with `node scripts/import-inputs.mjs`.
2. Send [prompt 6](../docs/prompts/06-baseline-pipeline.md) to the AI builder, pick `rhom-1` on the output and Apply.
3. `python data-validation/validate.py datasets/baseline.csv <downloaded GCS file> --name baseline`
