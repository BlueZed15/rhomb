# Rhombus AI: ETL Drift Testing

I tested Rhombus AI the way a customer would use it: a **scheduled pipeline from Amazon S3 to Google Cloud Storage**, built with the AI builder only. Then I broke the source data on purpose, first its structure (schema drift) and then its meaning (semantic drift), and watched what the platform did.

The data is real NSW FuelCheck fuel prices ([why](docs/decisions.md#d10-nsw-fuelcheck-fuel-prices-as-the-dataset)), with mess added by a seeded script so every run is reproducible.

I logged every decision as I made it, with why and what it cost, in the [decision log](docs/decisions.md) (15 entries, including the ones that didn't work out). Every prompt I sent the AI builder is saved in [`docs/prompts/`](docs/prompts/), and each drift case has a prediction I wrote down before running it.

Start with the [results table](#results) and [top three findings](#top-three-findings), then the [trade-offs I made](#6-judgement-calls-and-trade-offs). Rhombus-specific terms (LLM node, `code_sha`, From Web URL…) are explained in the [glossary](observations/README.md#terms-used-in-the-write-ups).

| Folder | What's in it |
|---|---|
| [`ui-tests/`](ui-tests/) | Playwright test of the whole journey: S3 source → AI-built pipeline → GCS destination → schedule |
| [`api-tests/`](api-tests/) | Playwright tests that call Rhombus's backend directly: 2 usual cases, 2 edge cases (forged tokens, cross-org access + odd IDs), 2 known issues |
| [`data-validation/`](data-validation/) | Python script comparing each GCS output with its input, plus the results for every run |
| [`datasets/`](datasets/) | The baseline, every drifted version, and the script that makes them |
| [`observations/`](observations/) | One write-up per case, with screenshots in [`evidence/`](observations/evidence/) |
| [`docs/`](docs/) | Setup steps, every AI-builder prompt I sent, and a [decision log](docs/decisions.md) |
| [`dashboard/`](dashboard/) | The bonus dashboard (built by `scripts/build_dashboard.py`), plus one saved GCS output per case in `dashboard/data/` |
| [`scripts/`](scripts/) · [`infra/`](infra/) | S3 upload/presign helpers, the test runner, IAM policies |

---

## 1. Setup and how to run

### What you need
- Node.js 20+ and Python 3.9+
- **Your own** AWS bucket + IAM key, GCS bucket + service account, and a Rhombus **test account** (email + password sign-up). [`docs/setup/`](docs/setup/) shows how I set mine up. Nothing of mine is in the repo: every account detail comes from `.env`.

```bash
npm ci
npx playwright install chromium
pip install -r requirements.txt
cp .env.example .env    # then fill in your AWS + GCS values (see the comments in the file)
python scripts/upload_dataset.py baseline    # puts the baseline in your bucket for the UI test
```

### Run the tests
```bash
npm run test:api          # asks for the Rhombus test account the first time, then reuses the session
npm run test:ui           # the full journey, about 3–10 minutes
npm run test:ui -- --fresh  # redo every step instead of resuming a half-finished journey
```
On Windows PowerShell use `npm.cmd`. The first login opens a browser window: if Rhombus asks for an MFA code, type it there. The email and password are only asked at the prompt and never written to disk.

### Run the data validation
Give it the file the pipeline read and the file it wrote. It reports what's different, with example rows, and a PASS or FAIL with the reasons:
```bash
python data-validation/validate.py datasets/baseline.csv dashboard/data/baseline.csv
python data-validation/validate.py datasets/schema-drift1-drop-column.csv --no-output    # when the run wrote nothing
```
My GCS outputs are in `dashboard/data/` (one per case), so the first command works straight after cloning. For your own runs, download the output from GCS and pass its path. The inputs are in [`datasets/`](datasets/) (`python datasets/generate.py` rebuilds them). Every run's result is in [`data-validation/results/`](data-validation/results/), and [`runs.csv`](data-validation/runs.csv) records which input and output each run used.

---

## 2. Observations summary

### Severity rubric
I fixed this before testing, so the labels weren't picked to fit the results. Severity is about the impact on a customer's data.

| Severity | Meaning |
|---|---|
| **Critical** | Wrong or missing data reaches GCS silently, and the run reports success. |
| **High** | The pipeline stops, but the logs or error don't help you find the cause. |
| **Medium** | The pipeline stops clearly, but the chatbot's diagnosis or fix is wrong or doesn't work. |
| **Low** | Handled correctly, with minor problems (wording, missing warnings, UX friction). |
| **None** | Handled correctly and clearly. |

**How I judge "chatbot fix worked?"** I paste the error with Ask Chatbot, apply what it suggests and re-run. It's a yes only if the chatbot fixes it **by itself**. If it needs me to point at the cause, or several prompts, that's a no.

**Every drift case starts from the same verified baseline pipeline.** After each case I rebuilt it and checked the output was byte-identical to the original before the next case ([why](observations/schema-drift3-change-type.md)).

### Results
Schema drift (`schema-drift1–5`) is Part 2 of the brief and semantic drift (`semantic-drift1–2`) is Part 3. Every file, result and screenshot for a case starts with its ID.

| ID | Case | Change | Pipeline stopped? | Reached GCS? | Chatbot fix worked? | Severity |
|---|---|---|---|---|---|---|
| | [Setup: S3 connection](observations/setup-s3-source-connection.md) | none | Never connected | No | No. Right cause, but a fix only Rhombus can apply | High |
| | [Baseline](observations/baseline.md) | none | No, passed | Yes, 2,363 rows | n/a | **Critical**: 733 dates silently swapped |
| schema-drift1 | [Drop column](observations/schema-drift1-drop-column.md) | `Brand` removed | Yes, clear error at the right node | Nothing | No. Wrong diagnosis, code unchanged | Medium |
| schema-drift2 | [Rename column](observations/schema-drift2-rename-column.md) | `Price` → `PriceCentsPerLitre` | Yes, clear error at the right node | Nothing | No. Right diagnosis, but the code that runs never changed | Medium |
| schema-drift3 | [Change type](observations/schema-drift3-change-type.md) | `2174` → `NSW 2174` | Yes, but two nodes late, with a generic error | Nothing | No. Blamed the wrong node | High |
| schema-drift4 | [Add column](observations/schema-drift4-add-column.md) | new `IsDiscounted` | Yes, but not because of the column | Yes, after 4 prompts, **57 rows short** | No | High |
| schema-drift5 | [All four at once](observations/schema-drift5-combined.md) | all of the above | One error at a time, then **"success"** | **Header-only file, 0 rows** | No. Its fixes made the failure silent | **Critical** |
| semantic-drift1 | [Cents → dollars](observations/semantic-drift1-cents-to-dollars.md) | `253.9` → `2.539` | No, a yellow popup, then **"success"** | **Header-only file, 0 rows** | n/a (nothing failed) | **Critical** |
| semantic-drift2 | [Dates as MM/DD](observations/semantic-drift2-date-mmdd.md) | `17/09` → `09/17` | No, silent success | Yes, and *more* correct than the baseline | n/a | High |

**Semantic drift: did my validation catch it?** Cents → dollars: yes, from the row count (0 rows vs 38 expected). MM/DD: it flagged a big mismatch, but its "expected" output applied my DD/MM rule to a US-format file, so it was the wrong side. I needed the answer key (the correct output my dataset script writes) to see that Rhombus was actually right ([details](observations/semantic-drift2-date-mmdd.md)). Rhombus noticed neither.

### Top three findings

1. **Green runs deliver wrong or empty data (Critical).** The baseline silently swaps day and month on 733 dates, because Rhombus guesses dates are month-first when it imports a file. In two drift cases a run reported "Pipeline completed successfully" and wrote a CSV with a header and no rows. In another, a "fixed" pipeline quietly lost 57 rows. Nothing in Rhombus flags any of it. There's no row count and no warning that stays on screen. My external validation was the only thing that caught it. A "0 rows written" alert and a date-format choice at import would fix most of this.

2. **The chatbot didn't fix anything by itself (0 of 6: the S3 setup and the five schema cases).** The pattern repeats:
   - It edits a step's instructions, but the old cached code keeps running (the code ID, `code_sha`, stays the same). It eventually admitted this.
   - It inspected the wrong dataset, and it blamed nodes two steps away from the real cause, ignoring Rhombus's own warning on screen.
   - Steps it created came with empty instructions, three times.
   - In the combined case, its fixes turned a clear error into a silent empty file, and left a pipeline that no longer ran on the original data.

3. **A scheduled pipeline can't see upstream changes, and changing its input breaks it.** The imported file is a one-time snapshot, so the schedule just logs "Skipped… unchanged data" forever and never notices the source changed. Pointing the pipeline at a new file wipes the settings of the built-in nodes and the output destination. Failures don't appear in the schedule's history. On top of that, the S3 connector itself was blocked inside Rhombus's own network, with an error telling me to fix a policy that was already correct.

Also from the API tests ([details](api-tests/README.md)):
- Imported datasets store the full presigned S3 link, signature and access key id included, readable by anyone on the project.
- A lowercase `bearer` scheme gets past the 401 check but then returns an empty project list, and a 500 error page on the project endpoint.
- Some things held up well. Every forged-token variant (including `alg:none`) gets a 401, another org's project is a 404 on every endpoint I tried, and odd IDs get a clean 404/422 with no stack traces.

---

## 3. Usability feedback

**What I liked.** When it works, the AI builder is fast: one prompt with nine numbered rules gave me a nine-step pipeline, and the canvas makes it easy to see what each step does. The outputs are deterministic (the same input gave byte-identical files across runs and rebuilds), which made testing fair. When a column is missing, the error names the node and the column. "Ask Chatbot" on a log error is a good idea.

**What was frustrating.** Most of my time went into things around the pipeline, not the pipeline itself:
- **During setup**, the S3 connector failed with a misleading error, and importing a CSV from a link failed ("no markdown table was found").
- **The logs** print "Pipeline failed" and "completed successfully" in the same second. The most useful warnings ("No results found…") are popups that vanish. Scheduled runs don't show up in Logs at all.
- **The chatbot's** edits don't always change the code that runs, and the only clue is an unchanged code ID in the error.
- **Small things add up.** The model choice resets to the default on every page load, destinations have to be re-added per project, the builder can't set the destination it just created, and automated browsers get an "Ad Blocker Detected" popup that blocks clicks.

**What would help most.**
1. Show the row count each step outputs, and warn or fail when a run writes 0 rows.
2. Check the incoming schema and date format at import, and say what you guessed.
3. Make a chatbot fix visibly regenerate the code (or say it didn't), and re-run the failing step before claiming it's fixed.

Day-to-day friction is in the [friction log](docs/setup/03-rhombus-pipeline.md#friction-log).

---

## 4. Demo video
> _Link to be added._ A 3-minute walkthrough of the UI tests, API tests and data validation: setup, where credentials go, how to run each suite, and what you'll see. Captions, no voiceover. It's generated from the repo by [`scripts/make-demo-video.mjs`](scripts/make-demo-video.mjs); see [docs/demo-video.md](docs/demo-video.md).

---

## 5. Observability dashboard (bonus)
**[bluezed15.github.io/rhomb/dashboard](https://bluezed15.github.io/rhomb/dashboard/)** is one interactive page with the four views the brief asks for:
- **Pipeline health** is a bar chart of every run for the baseline and each case, `schema-drift1` to `semantic-drift2` (succeeded vs failed), with my validator's verdict at the end of each bar. Click a bar to list its runs. Runs that failed on export setup aren't about the drift, so they're left out.
- **Output consistency** shows the sha256 of every repeat run of the same input (5 baseline runs across 3 separate builds were identical, from [`consistency.csv`](data-validation/consistency.csv)), then a side-by-side diff. Pick any two files (inputs, the answer key, or one output per case) and press Run, and it shows them as tables with the changed cells highlighted. I didn't repeat each drift case, because every run costs credits and a manual re-import.
- **Capability heat map** is each drift case × what a customer needs (noticed it, clear error, right data, chatbot fix, schedule), with a handled / breaks / missed verdict per drift. Hover to trace a row and column; click a cell for the reason and the evidence.
- **Execution time** is a box plot per case with every run as a dot, and the baseline as a reference.

It's a static page built from the repo's own data by [`scripts/build_dashboard.py`](scripts/build_dashboard.py): every run in [`rhombus-runs.csv`](data-validation/rhombus-runs.csv), the validator's [results](data-validation/results/), the [datasets](datasets/), and the downloaded outputs (copied into `dashboard/data/`). The heat map is my judgement per case, with each cell linked to its write-up. To view it locally, run `python -m http.server` in the repo root and open `localhost:8000/dashboard/` (the diff tool loads files, so it needs a server).

---

## 6. Judgement calls and trade-offs
The calls that shaped the results. I kept a [decision log](docs/decisions.md) as I went: every choice, why I made it, and what it cost, including where a plan didn't hold up (e.g. D6, D8). These are the ones that matter most:

| Call | Why | What it cost |
|---|---|---|
| **A presigned S3 link instead of the S3 connector** | The connector was denied inside Rhombus's own network, even with their exact policy | It's not the connector the brief asks for, and the import is a snapshot, so drift runs were started by re-importing the file, not by the schedule ([D9](docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)) |
| **Every drift case starts from the same verified pipeline** | So one case's chatbot fix can't leak into the next | A rebuild and a byte-for-byte check before each case. My first schema-drift3 attempt skipped this, and I had to redo it ([D6](docs/decisions.md#d6-every-drift-case-starts-from-the-same-verified-baseline)) |
| **A strict "fixed by itself" rule for the chatbot** | It's what matters to someone relying on it | Harsher than a patient user would be. It's applied the same way to every case ([D11](docs/decisions.md#d11-a-strict-rule-for-did-the-chatbots-fix-work)) |
| **Seven cases, one run each** | Breadth: every case the brief lists | It shows each behaviour happens, not how often ([D14](docs/decisions.md#d14-breadth-over-repetition)) |
| **Read-only API tests, bugs as expected failures** | Safe on a real account, and findings stay visible | Write endpoints aren't covered by the API suite ([D13](docs/decisions.md#d13-api-tests-are-read-only-and-known-bugs-are-written-as-expected-failures)) |
| **A separate test account for the automated tests** | Keeps my own login out of the tests | The UI journey still puts a presigned link and the GCS key into Rhombus, so I run it myself and keep the report ([D12](docs/decisions.md#d12-tests-run-on-a-separate-test-account-and-type-no-secrets-of-mine)) |

## Limitations and what was not tested
- **One run per drift case** (plus a clean re-run of the type change). That shows a behaviour happens. It doesn't rule out variance, especially in the chatbot, which gives different answers each time.
- **No S3 connector.** It was blocked, so the source is a presigned link through Rhombus's "From Web URL" import ([D9](docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)). Because that's a snapshot, drift runs were triggered by re-importing the file, not by the schedule itself.
- **"What happens to the schedule" is answered properly only for schema-drift1 and schema-drift2.** There, the schedule stayed active, skipped every run as "unchanged data", and never recorded the failures. From schema-drift3 on I worked in a clean project without a schedule, since I already knew it would skip the same way. Each write-up says so.
- **My validator checks my rules, not ground truth.** That's fine for most cases, but it misjudged the MM/DD case, where Rhombus's guess happened to be right. I used the answer key there.
- **Outputs were downloaded by hand** from GCS (I didn't set up a read-only key), with each file and run recorded in [`runs.csv`](data-validation/runs.csv).
- **Free plan limits.** 3 projects and limited credits shaped how often I could rebuild.
- **API tests only read.** I didn't call write endpoints (create, delete, run) against a real account, and I didn't load-test a production service.

## Test reliability (flakiness)
Retries are off in [`playwright.config.ts`](playwright.config.ts), so a flaky step shows up as a failure instead of quietly passing on a second try.

| Suite | Known instability | Cause | How it's handled |
|---|---|---|---|
| UI | An "Ad Blocker Detected" popup appears at random and swallows clicks | Rhombus's tracking scripts don't load in Playwright's browser | A handler closes it whenever it appears, and the step it interrupted is retried as a whole |
| UI | The AI builder takes 1–3 min, and the first run after a rebuild is slower | Code is generated per node on the first run | Waits on real signals (node count from the API, the newest log line), never fixed sleeps |
| UI | The builder's output varies: node labels, LLM vs built-in nodes | It's an LLM | Assertions use node *types* from the API and the output label pattern, not exact names |
| UI | A half-finished journey blocks the Free plan's 3 projects | Failed runs leave projects behind | Reruns resume the unfinished project; `--fresh` starts clean |
| API | The saved session expires | Short-lived login | The setup step checks it and logs in again when needed |
| API | The pipeline test needs a pipeline to exist | It runs against real account data | It skips with a clear message until the UI journey has built one |
| API | Known issues are expected failures | Real Rhombus bugs | `test.fail()` keeps the suite green and flips when Rhombus fixes them, so they can't rot silently |
| Validation | Downloading the wrong output file by hand | No GCS read key | `runs.csv` records the exact object for each run, and a sha256 is stored with every result |

## If this were production
- Run the validation automatically after every scheduled run and alert on failure: a row count of 0, a schema change, values outside their normal range.
- Enforce a data contract (schema, types, value ranges, date format) at the source, before the pipeline runs.
- Keep a golden baseline output and diff every run against it, as I did by hand with sha256.
- Treat chatbot changes like code changes: review the diff, re-run, and keep the version history so they can be undone.
- Run these tests in CI against a dedicated test org, with secrets in the CI secret store and MFA answered from a TOTP secret.
