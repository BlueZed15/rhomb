# 03. Rhombus AI: baseline pipeline

The goal is an S3 source → cleaning pipeline built **with the AI builder only** → GCS destination → schedule. Then **one successful scheduled run** as the baseline.

> The S3 connector was blocked, so the input is a presigned link through From Web URL ([D9](../decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)). It took 5 prompts to work out a pipeline prompt that runs, then one prompt built the baseline every result uses ([prompt log](#prompt-log)). I picked the GCS destination by hand, because the builder can't. The first scheduled run passed at 18:35 on 2026-10-23 ([write-up](../../observations/baseline.md)).

Before starting, [01](01-aws-s3.md) and [02](02-gcp-gcs.md) should be done, and the files uploaded with `python scripts/upload_dataset.py <case>` (xlsx, because From Web URL rejects CSV).

While doing this, I kept DevTools → Network open to record the [endpoints](#endpoints-observed) used by `api-tests/`, and noted problems in the [friction log](#friction-log). Screenshots are in `observations/evidence/setup/` and `pipeline/`.

## Values used

| Item | Value |
|---|---|
| Rhombus account | my own (GitHub sign-in) for the drift runs; a separate email + password test account for the automated tests |
| Plan / tier | Free (3 projects, credits topped up with a voucher) |
| Projects | `fuelcheck-drift` (workflow 5359): every result. Its canvas holds the baseline pipeline and its drift copy. `drift1` is where prompts 1–5 worked out the pipeline prompt |
| Input | Every file imported once into `fuelcheck-drift` by `scripts/import-inputs.mjs`: `Table 1.csv` (baseline, dataset 4720) to `Table 1 (7).csv` ([rhombus-datasets.json](../../data-validation/rhombus-datasets.json)) |
| Schedule | every 5 min (`*/5 * * * *`), notify on failure, created 2026-10-23 18:30 |
| Baseline run | first run 2026-10-23 18:13; first scheduled run 18:35 (Execution #19672) |
| Output object in GCS | `rhom-1/baseline/baseline-output.csv` (sha256 `503fd6ed…`, the same for every repeat). Each case's output is in its own folder; see [runs.csv](../../data-validation/runs.csv) |

---

## Step 1. Sign up
Free plan. It allows 3 projects, and the credits ran low, so I redeemed a voucher.

## Step 2. Connect S3 source
**Data → Sources → Amazon S3**
- Bucket: `<SOURCE_BUCKET>` · Region: (from 01) · **Folder / path: `input/`** · Source name: `qa-s3-source`
- Expand **AWS access setup** → apply the policy as in [01 → Step 4](01-aws-s3.md#step-4-grant-rhombus-read-access) → **Connect S3 source**.

**This step failed** ([write-up](../../observations/setup-s3-source-connection.md)).
> I scope it to `input/` so Rhombus can't read anything else in the bucket ([01 → Step 2](01-aws-s3.md#step-2-create-the-input-folder)).

## Step 3. Build the pipeline with the AI builder
Create a project, add the input (here: the presigned link through From Web URL), then open the AI builder.

**Rule: AI builder only.** I didn't edit any node by hand. When the builder got something wrong, I corrected it **by prompting**, and logged each correction below.

### Prompt design
The prompt lists the **cleaning rules explicitly and numbered**, the same rules the validator checks ([`datasets/README.md`](../../datasets/README.md#cleaning-rules)). A vague prompt ("clean this data") would leave the expected output undefined, so nothing could fail.

### Prompt log
Every message I sent the builder, including corrections, in the order sent. Prompts 1–5 were in `drift1`, where I worked out a pipeline prompt that runs; prompts 6 and 7 built the pipeline every result uses, in `fuelcheck-drift`. (Prompt 2 was sent last of the first five, so it appears after 5.)

| # | Prompt (exact text, or link to file) | What the builder produced | Accepted? / why |
|---|---|---|---|
| 1 | [Build the cleaning pipeline](../prompts/01-pipeline-cleaning.md) | 9 nodes, one per rule: built-in ones (Text Case, Remove Duplicates) plus several "Custom" LLM nodes (`llm_node_3` brand casing, `llm_node_4` postcode, `llm_node_6` dates). It said "the canvas keeps reverting to 1 node between calls" and rebuilt everything in one go. No output node. 5 credits. | Yes, pending a run |
| — | *Switched the model from Facet (Sonnet 4.6, low) to Lattice (Opus 4.6, medium). First run failed: `price_clean` dropped every row, then "Pipeline failed at deduped_output: DataFrame should not be empty". The log also says "completed successfully" at the same second* ([screenshot](../../observations/evidence/pipeline/01-sonnet-price-clean-no-results.jpg), [red nodes](../../observations/evidence/pipeline/02-canvas-red-nodes-before-run.jpg)). | | |
| 3 | [Fix the price step](../prompts/03-fix-price-step.md) | Rewrote `price_clean`'s prompt "more defensively" and said it stopped resetting the index. The `date_format` warning cleared. The re-run **still failed** the same way ([screenshot](../../observations/evidence/pipeline/03-lattice-fix-still-fails.jpg)). 5 credits. | No, the fix didn't work |
| — | *I checked node previews and code myself (free). The real cause was `whitespace_trim`, a "Comprehensive Text Cleanup" node that strips all punctuation (261.9 → 2619, 7-Eleven → 7Eleven), so `price_clean` correctly drops every row. Lattice's prompt-3 fix had also only changed `price_clean`'s instruction, not its code, which still resets the index* ([text cleanup](../../observations/evidence/pipeline/05-text-cleanup-strips-punctuation.jpg), [prompt vs code](../../observations/evidence/pipeline/04-price-clean-prompt-vs-code.md)). | | |
| 4 | [Replace the Text Cleanup node](../prompts/04-replace-text-cleanup.md) | Agreed straight away ("strips all punctuation by default when retain_characters is empty") and swapped in a Custom LLM node, but left its **instruction empty**. The run now fails at step 1: "LLM transform requires a non-empty prompt when code is not provided." ([screenshot](../../observations/evidence/pipeline/06-replacement-node-empty-prompt.jpg)) 5 credits. | No, the fix broke the first step |
| — | *Redeemed voucher credits (balance 5,010). After the page reload the model had reset to Facet, so I re-selected Lattice.* | | |
| 5 | [Fill in the empty node](../prompts/05-fill-empty-node.md) | Gave `whitespace_trim` an instruction with examples (261.9 and 7-Eleven stay unchanged). It didn't do the "check it runs" I asked for, it just said to re-run. **The run succeeded** after 138 s, and `RhombusAI_output_1792609629121.csv` (283.4 KB) landed in `rhom-1`. 5 credits. | Yes. Output not yet checked against the answer key. |
| 2 | [Add the GCS output](../prompts/02-add-gcs-output.md) | Added the Data Output node (CSV) after dedup, but "destination IDs are not accessible through the pipeline tools", so I picked `rhom-1` by hand (output setup, not a transformation). 5 credits. | Yes |
| 6 | [Build the baseline pipeline](../prompts/06-baseline-pipeline.md) | In `fuelcheck-drift`: prompts 1–5's rules as one prompt, every node prefixed `base_`. 11 nodes in one go (2 min 3 s). It saved the destination as a name, so I picked `rhom-1` by hand. First run 104 s, `503fd6ed…` | Yes |
| 7 | [Add an exact drift copy](../prompts/07-drift-copy.md) | Copied the prompts but not the code (it can't set code), and rewrote all seven `base_` LLM steps and the baseline output, which I'd told it not to touch. Its summary said no `base_` node was modified | No. I restored the baseline from a snapshot and pasted the code into the copy by hand |


## Step 4. GCS destination
**Data Output node → Select Destination → Add New Destination → Google Cloud Storage** → paste the service-account JSON, bucket `rhom-1` → **Create Destination**. Then select it in the node, with CSV as the format.
- The AI builder can add the output node, but it writes the destination's **name** where Rhombus wants its numeric ID, so every run fails until you select it by hand ([friction log](#friction-log)).
- Each run writes a new file at the bucket root, `<custom filename>_<timestamp>.csv` (`RhombusAI_output_…` if you leave it blank), so nothing is overwritten. I used `fuelcheck-<case-id>`, then afterwards renamed the outputs that matter into one folder per case (`baseline/baseline-output.csv`, `<case-id>/drift-output.csv`) and moved the rest into `old-runs/`.

> I chose CSV over Excel because the validator compares data, not file-format quirks, and the diffs stay readable.

## Step 5. Schedule
Every 5 minutes, with notify-on-failure on. It runs the whole canvas, both pipelines.
> What I learned: the imported file is a snapshot, so the schedule never sees a changed source and logs "Skipped… unchanged data". So each drift file is imported once and a case switches the input ([D5](../decisions.md#d5-each-drift-file-is-its-own-import-and-a-case-switches-the-input)). The schedule does record failures (failed node and completed nodes), retries them every 5 minutes, and stops after a success until something changes. After a long run of failures it turned itself Inactive. Executions only keeps the last 10.

## Step 6. Baseline run
The first run (2026-10-23 18:13) and the first scheduled run (18:35) both passed. Every later baseline output and every pre-check of the drift copy was byte-identical ([consistency.csv](../../data-validation/consistency.csv)). The validation result is in [`results/baseline.json`](../../data-validation/results/baseline.json).
> The drift copy is reset to the baseline before every case and checked byte for byte ([D6](../decisions.md#d6-the-baseline-is-its-own-pipeline-on-the-same-canvas)).

---

## Endpoints observed
From the Network tab while using the app. The API is `https://api.rhombusai.com/api`. Every call carries `Authorization: Bearer <jwt>`, a short-lived token the frontend gets from its own session endpoint. Tokens were never pasted anywhere. These feed [`api-tests/`](../../api-tests/).

| Action in UI | Method | Path | Auth | Status seen | Response notes |
|---|---|---|---|---|---|
| Log in / any page | GET | `rhombusai.com/api/auth/session` | login cookie | 200 | `{user, expires, accessToken}`. The JWT used everywhere below |
| Sidebar project list | GET | `/dataset/projects/all` | Bearer | 200 / 401 without it | `{items:[{id, name, organization_id, org_role, project_role, …}]}` |
| Open a project | GET | `/dataset/projects/{id}/context` | Bearer | 200, or 404 for other orgs and missing ids | `{id, organization_id, org_role, project_role}` |
| Draw the canvas | GET | `/dataset/analyzer/v2/projects/{id}/nodes` | Bearer | 200 | Each node's `name`, `transformer_type`, `params` (prompt, code, `dataset_id`, `destination_id`), `inputs`/`outputs` |
| Data Input panel | GET | `/dataset/analyzer/v2/projects/{id}/datasets` | Bearer | 200 | Imported datasets. `description` holds the full presigned URL |
| Chat panel | GET | `/dataset/analyzer/v2/projects/{id}/chat/history` | Bearer | 200 | Not tested |
| Schedule tab | GET | `/accounts/users/schedule-limit` | Bearer | 200 | `{limit, current_count}`. Not tested |
| Header credits | GET | `/accounts/users/credits` | Bearer | 200 | Not tested |

## Friction log
Written as things happened, so it isn't tidy. The README's usability section is the summary.

| When | What happened | Impact |
|---|---|---|
| 2026-10-21 18:58–19:10 | Connect S3 source failed repeatedly with "policy missing or does not match", even though the bucket policy matched the generated one exactly. CloudTrail shows Rhombus's own VPC endpoint getting AccessDenied. Full write-up: [setup-s3-source-connection](../../observations/setup-s3-source-connection.md) | **Blocking.** About 2 hours of debugging a policy that was already correct |
| 2026-10-21 | The region dropdown defaults to `us-east-1` and isn't checked against the bucket's real region | Easy to get wrong silently |
| 2026-10-21 | The pricing page says the Free plan has 1 data connection and no scheduled runs, while the exercise needs 2 connections and a schedule. In practice the schedule and GCS destination worked | Confusing, and the UI doesn't warn about plan limits |
| 2026-10-21 | The Data Input node has sampling on by default (first 100k rows) | No effect here (2,613 rows), but it would silently cut a bigger file |
| 2026-10-22 | From Web URL on a CSV link: "no markdown table was found" (another time a "document_antibot" scrape error). The same data as `.xlsx` works | Had to change the file format to get data in |
| 2026-10-22 | The model picker resets to Facet (Sonnet) on every page load | Easy to send a prompt on the wrong model |
| 2026-10-22 | The AI builder writes the destination's *name* (`"rhom-1"`) where Rhombus wants its numeric id. Every run fails with "Field 'id' expected a number" until you pick the destination by hand. The builder's own reply admits it can't look destinations up | Every pipeline it builds needs a manual step |
| 2026-10-22 | Destinations belong to a project, so every new project needs the GCS key pasted again | Repeated setup, and the key is handled more often |
| 2026-10-22 | The imported file is a snapshot, so the schedule logs "Skipped N time(s)… unchanged data" and never re-reads S3 | Scheduled pipelines can't see upstream changes |
| 2026-10-22 | Switching the input dataset wipes the settings of built-in nodes (Text Case, Remove Duplicates) and the output destination | Every input change breaks the pipeline |
| 2026-10-22 | Logs print "Pipeline failed" and "Pipeline execution completed successfully" in the same second. The key warnings are popups that disappear. Scheduled runs don't appear in Logs | Hard to tell what actually happened |
| 2026-10-22 | In automated Chromium (Playwright), an "Ad Blocker Detected" popup appears at random and blocks clicks | The UI tests need a handler for it |
| 2026-10-22 | The Free plan allows 3 projects and there's no "duplicate project" or copy/paste of nodes | The drift copy had to be made by pasting each step's code |
| 2026-10-23 | The AI builder can't set a step's code; asked to copy a pipeline, it also rewrote the original | No reliable way to clone a pipeline |
| 2026-10-23 | Logs belong to the browser session: a reload empties them, and Ask Chatbot needs a log entry | I had to re-run to get the button back |
| 2026-10-24 | "No results found" warning cards cover the newest log entry and the Run button, and have no close button | Hard to act on the newest error |
