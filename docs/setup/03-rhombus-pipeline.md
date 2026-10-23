# 03. Rhombus AI: baseline pipeline

The goal is an S3 source → cleaning pipeline built **with the AI builder only** → GCS destination → schedule. Then **one successful scheduled run** as the baseline.

> The S3 connector was blocked, so the input is a presigned link through From Web URL ([D9](../decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)). The AI builder needed 5 prompts to get a working pipeline (the [prompt log](#prompt-log) below shows each one). I picked the GCS destination by hand, because the builder can't. The baseline scheduled run passed at 06:30 on 2026-10-22 ([write-up](../../observations/baseline.md)). Terms are explained in the [glossary](../../observations/README.md#terms-used-in-the-write-ups).

Before starting, [01](01-aws-s3.md) and [02](02-gcp-gcs.md) should be done, and the baseline is live at `s3://<SOURCE_BUCKET>/input/fuelcheck.xlsx` (Rhombus can only import xlsx through From Web URL, see D9).

While doing this, I kept DevTools → Network open to record the [endpoints](#endpoints-observed) used by `api-tests/`, and noted problems in the [friction log](#friction-log). Screenshots are in `observations/evidence/setup/` and `pipeline/`.

## Values used

| Item | Value |
|---|---|
| Rhombus account | my own (GitHub sign-in) for the drift runs; a separate email + password test account for the automated tests |
| Plan / tier | Free (3 projects, credits topped up with a voucher) |
| Projects | `drift1` (schema-drift1 to schema-drift3, first attempt), `fuelcheck-baseline` (the clean baseline every drift case started from) |
| Input | `input/fuelcheck.xlsx` (live), with numbered copies in `input/archive/` (see [runs.csv](../../data-validation/runs.csv)) |
| Schedule | every 10 min during Part 1, then paused; every 5 min for the first drift runs |
| Baseline run | scheduled run on 2026-10-22 06:30 AEDT |
| Input `VersionId` | `agVxCR4X…aOaG` (the baseline row in [runs.csv](../../data-validation/runs.csv)) |
| Output object in GCS | `rhom-1/RhombusAI_output_1792611024553.csv` |

---

## Step 1. Sign up
Free plan. It allows 3 projects, and the credits ran low, so I redeemed a voucher.
> I note the plan because if something is missing later, the plan tells you whether it's a limitation or a bug.

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
The prompt lists the **cleaning rules explicitly and numbered**, the same rules the validator checks.
> I spelled the rules out because a vague prompt ("clean this data") makes the expected output undefined, so no validation could fail. Explicit rules give the AI builder a clear specification and make its result testable. Each rule maps to a check in `data-validation/`.

The exact prompts are in [`docs/prompts/`](../prompts/), and the rules come from [`datasets/README.md`](../../datasets/README.md#cleaning-rules).

### Prompt log
Every message I sent the builder for the baseline, including corrections, in the order sent. It makes the pipeline reproducible, and shows how the builder behaves. (Prompt 2 was sent last, so it appears at the end.)

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
| 6 | [Rebuild in a clean project](../prompts/06-rebuild-clean-baseline.md) | Before the clean re-run of drift case 3: the same rules, with rule 1 spelled out as "whitespace only". 9 nodes in one go, and the output was byte-identical to the original baseline | Yes |
| 7 | [Rebuild before schema-drift5 and semantic-drift1](../prompts/07-rebuild-before-schema-drift5.md) | The chatbot's earlier fixes had changed the pipeline, so I cleared it and rebuilt. It made every step an LLM node "to avoid the params-dropping issue". The output was still byte-identical | Yes |

> If the builder needs more than one try, that isn't a failure to hide. "Needed N corrections to apply rule X" is a usability finding.

## Step 4. GCS destination
**Data Output node → Select Destination → Add New Destination → Google Cloud Storage** → paste the service-account JSON, bucket `rhom-1` → **Create Destination**. Then select it in the node, with CSV as the format.
- The AI builder can add the output node, but it writes the destination's **name** where Rhombus wants its numeric ID, so every run fails until you select it by hand ([friction log](#friction-log)).
- Each run writes a new file at the bucket root, `RhombusAI_output_<timestamp>.csv`, so nothing is overwritten.

> I chose CSV over Excel because the validator compares data, not file-format quirks, and the diffs stay readable.

## Step 5. Schedule
I scheduled the pipeline every 10 minutes for the baseline, then paused it. For the first drift runs I set it to every 5 minutes.
> What I learned is that the schedule never re-reads the source. The imported file is a snapshot, so it logs "Skipped… unchanged data" and every drift run had to be started by re-importing the file ([D5](../decisions.md#d5-drift-goes-in-by-overwriting-the-same-file)).

## Step 6. Baseline run
The first **scheduled** run (06:30, 2026-10-22) passed and wrote `rhom-1/RhombusAI_output_1792611024553.csv`. It was byte-identical to a manual run 20 minutes earlier. The input and output are recorded as the baseline in [`runs.csv`](../../data-validation/runs.csv), and the validation result is in [`results/baseline.json`](../../data-validation/results/baseline.json).
> I used a scheduled run rather than a manual one because the brief asks for it, and it rules out the trigger as the cause of any difference.
>
> Rhombus can't duplicate a project, so the "restore point" between drift cases is a rebuild from the same prompt, checked byte for byte ([D6](../decisions.md#d6-every-drift-case-starts-from-the-same-verified-baseline)).

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
| 2026-10-21 | The pricing page says the Free plan has 1 data connection and no scheduled runs, while the exercise needs 2 connections and a schedule. The UI doesn't warn about plan limits before setup. | Possible blocker for the exercise. Needs confirming with Rhombus. |
| 2026-10-21 | The Data Input node has sampling on by default (first 100k rows) | Could affect row counts in scheduled runs. Needs checking. |
| 2026-10-22 | From Web URL on a CSV link: "no markdown table was found" (another time a "document_antibot" scrape error). The same data as `.xlsx` works | Had to change the file format to get data in |
| 2026-10-22 | The model picker resets to Facet (Sonnet) on every page load | Easy to send a prompt on the wrong model |
| 2026-10-22 | The AI builder writes the destination's *name* (`"rhom-1"`) where Rhombus wants its numeric id. Every run fails with "Field 'id' expected a number" until you pick the destination by hand. The builder's own reply admits it can't look destinations up | Every pipeline it builds needs a manual step |
| 2026-10-22 | Destinations belong to a project, so every new project needs the GCS key pasted again | Repeated setup, and the key is handled more often |
| 2026-10-22 | The imported file is a snapshot, so the schedule logs "Skipped N time(s)… unchanged data" and never re-reads S3 | Scheduled pipelines can't see upstream changes |
| 2026-10-22 | Switching the input dataset wipes the settings of built-in nodes (Text Case, Remove Duplicates) and the output destination | Every input change breaks the pipeline |
| 2026-10-22 | Logs print "Pipeline failed" and "Pipeline execution completed successfully" in the same second. The key warnings are popups that disappear. Scheduled runs don't appear in Logs | Hard to tell what actually happened |
| 2026-10-22 | In automated Chromium (Playwright), an "Ad Blocker Detected" popup appears at random and blocks clicks | The UI tests need a handler for it |
| 2026-10-22 | The Free plan allows 3 projects and there's no "duplicate project" | Resetting the baseline meant rebuilding from the prompt |
