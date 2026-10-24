# observations/

One write-up per case. Start with the [results table in the main README](../README.md#results), then open whichever case interests you.

## How to read a write-up
Every case has the same parts:
- **A summary table**: what changed, whether the pipeline stopped, what reached GCS, whether the chatbot fixed it, and a severity from the [rubric](../README.md#severity-rubric).
- **What I expected**, written before the run, so you can see where I was wrong.
- **What happened**, with the exact error text and a screenshot link for each claim.
- **The logs, the chatbot, the schedule**, which with "what happened" are the four questions the brief asks for every case.
- **What I think**: my judgement, kept short.
- **Reproduce**: the commands to run it again. They assume the setup in [`docs/setup/`](../docs/setup/) is done (your bucket, the GCS destination, and a project with the baseline pipeline from [prompt 6](../docs/prompts/06-baseline-pipeline.md) plus its drift copy).

Screenshots are in [`evidence/`](evidence/): `setup/` (connecting S3), `pipeline/` (developing the pipeline prompt), `baseline/` (the baseline build) and `drift/` (the drift runs, numbered in the order they happened, `NN-<case-id>-<what it shows>.jpg`).

## Order of the cases
1. [Setup: S3 connection](setup-s3-source-connection.md): why the source is a link instead of the S3 connector
2. [Baseline](baseline.md): the clean run everything is compared against
3. Schema drift (Part 2): [schema-drift1 drop](schema-drift1-drop-column.md) · [schema-drift2 rename](schema-drift2-rename-column.md) · [schema-drift3 change type](schema-drift3-change-type.md) · [schema-drift4 add](schema-drift4-add-column.md) · [schema-drift5 all four at once](schema-drift5-combined.md)
4. Semantic drift (Part 3): [semantic-drift1 cents → dollars](semantic-drift1-cents-to-dollars.md) · [semantic-drift2 dates as MM/DD](semantic-drift2-date-mmdd.md)

## Terms used in the write-ups
| Term | What it means |
|---|---|
| **AI builder / chatbot** | Rhombus's chat panel. "AI builder" is when I ask it to build or change the pipeline; "chatbot" is when I paste an error with its **Ask Chatbot** button and ask for a fix. It's the same assistant |
| **Pipeline mode** | A chat mode (typed as `/pipeline`) that lets the assistant edit the pipeline directly |
| **Lattice / Facet** | Rhombus's model choices. Lattice is the stronger one (Opus 4.6); Facet (Sonnet 4.6) is the default and comes back on every page load. I used Lattice for the chatbot |
| **Node** | One step on the pipeline canvas |
| **Built-in node** | A ready-made step with settings (e.g. "Change Text Case", "Remove Duplicates") |
| **LLM node** | A step where Rhombus writes Python from a plain-English instruction, then runs that code |
| **`code_sha`** | An ID for the code an LLM node actually runs, printed in its errors. If a "fix" leaves it unchanged, the fix didn't change what runs |
| **Data Input / From Web URL** | The input step, and its option to import a file from a link. I used it with a presigned S3 link (a temporary signed link, so no keys are shared) because the S3 connector was blocked ([D9](../docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)) |
| **`Table 1.csv`, `Table 1 (3).csv`** | The names Rhombus gives each imported file. A new import gets the next number |
| **`fuelcheck-drift`** | The Rhombus project every case ran in. Its canvas holds two pipelines ([D6](../docs/decisions.md#d6-the-baseline-is-its-own-pipeline-on-the-same-canvas)) |
| **Baseline pipeline / drift pipeline** | The baseline (`base_…` steps) always reads `Table 1.csv` and is never edited. The drift pipeline (`drift_…` steps) is an exact copy that gets each drift file and the chatbot's fixes, and is reset to the baseline before each case |
| **Pre-check** | The run of the reset drift pipeline on `Table 1.csv` before each case. Its output must be byte-identical to the baseline's |
| **GCS outputs** | Rhombus writes `fuelcheck-<case-id>_<ms>.csv` at the bucket root. I kept one file per case, renamed into a folder: `rhom-1/baseline/baseline-output.csv` and `rhom-1/<case-id>/drift-output.csv` (`output-after-chatbot-fix.csv` for schema-drift3). Everything else is in `old-runs/` |
| **`drift1`, `fuelcheck-baseline`** | Older projects from developing the pipeline prompt. Not used for the results |
| **schema-drift1–5, semantic-drift1–2** | Case IDs. Schema drift is Part 2 of the brief: one change at a time, then all four at once (schema-drift5). Semantic drift is Part 3. [`runs.csv`](../data-validation/runs.csv) maps each case to its input in S3 and its output in GCS |
| **Answer key** | The correct cleaned output, written by my dataset script ([`baseline_expected.csv`](../datasets/)). Used to check what Rhombus produced |
| **Byte-identical / sha256** | Two files are exactly the same, down to the byte. The baseline output is `503fd6ed…` |
