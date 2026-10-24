# Rhombus AI: ETL Drift Testing

I tested Rhombus AI the way a customer would use it: a **scheduled pipeline from Amazon S3 to Google Cloud Storage**, built with the AI builder only. Then I broke the source data on purpose, first its structure (schema drift) and then its meaning (semantic drift), and watched what the platform did.

The data is real NSW FuelCheck fuel prices ([why](docs/decisions.md#d10-nsw-fuelcheck-fuel-prices-as-the-dataset)), with mess added by a seeded script so every run is reproducible. I wrote a prediction before each drift case, saved every prompt I sent the AI builder in [`docs/prompts/`](docs/prompts/), and logged each decision and what it cost in the [decision log](docs/decisions.md).

Start with the [results table](#results) and [top three findings](#top-three-findings). Rhombus terms (LLM node, `code_sha`, drift pipeline…) are in the [glossary](observations/README.md#terms-used-in-the-write-ups).

| Folder | What's in it |
|---|---|
| [`ui-tests/`](ui-tests/) | Playwright test of the whole journey: S3 source → AI-built pipeline → GCS destination → schedule |
| [`api-tests/`](api-tests/) | Playwright tests that call Rhombus's backend directly: 2 usual cases, 2 edge cases (forged tokens, cross-org access + odd IDs), 2 known issues |
| [`data-validation/`](data-validation/) | Python script comparing each GCS output with its input, plus the results for every run |
| [`datasets/`](datasets/) | The baseline, every drifted version, and the script that makes them |
| [`observations/`](observations/) | One write-up per case, with screenshots in [`evidence/`](observations/evidence/) |
| [`docs/`](docs/) | Setup steps, every AI-builder prompt I sent, and a [decision log](docs/decisions.md) |
| [`dashboard/`](dashboard/) | The bonus dashboard, with the GCS outputs it compares in `dashboard/data/` |
| [`scripts/`](scripts/) · [`infra/`](infra/) | Upload and import helpers, the test runner, the dashboard builder, IAM policies |

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
My GCS outputs are in `dashboard/data/`, so the first command works straight after cloning. For your own runs, download the output from GCS and pass its path. Results are in [`data-validation/results/`](data-validation/results/).

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

**How each case ran.** The baseline is its own pipeline, next to an exact copy on the same canvas. Each case switches the copy's input to the drifted file, and the chatbot's fixes land on the copy. Before every case I reset the copy and checked its output was byte-identical to the baseline's ([D6](docs/decisions.md#d6-the-baseline-is-its-own-pipeline-on-the-same-canvas)). Every setup ran at least 3 times and behaved the same each time.

### Results
Schema drift (`schema-drift1–5`) is Part 2 of the brief, semantic drift (`semantic-drift1–2`) is Part 3. Every file and screenshot for a case starts with its ID.

| ID | Case | Change | Pipeline stopped? | Reached GCS? | Chatbot fix worked? | Severity |
|---|---|---|---|---|---|---|
| | [Setup: S3 connection](observations/setup-s3-source-connection.md) | none | Never connected | No | No. Right cause, but a fix only Rhombus can apply | High |
| | [Baseline](observations/baseline.md) | none | No, passed | Yes, 2,363 rows | n/a | **Critical**: 733 dates silently swapped |
| schema-drift1 | [Drop column](observations/schema-drift1-drop-column.md) | `Brand` removed | Yes, at the right node (bare `KeyError`) | Nothing | No. Wrong diagnosis, and it edited the **baseline** pipeline | Medium |
| schema-drift2 | [Rename column](observations/schema-drift2-rename-column.md) | `Price` → `PriceCentsPerLitre` | Yes, clear error at the right node | Nothing | No. Its fix moved the failure and broke the step for the original file | Medium |
| schema-drift3 | [Change type](observations/schema-drift3-change-type.md) | `2174` → `NSW 2174` | Yes, but at dedup, two steps late (a canvas card flags the right step) | Nothing; after the fix, **4 rows with a made-up postcode** | Partly. Green run, but it changed the rule | High, **Critical** after the fix |
| schema-drift4 | [Add column](observations/schema-drift4-add-column.md) | new `IsDiscounted` | No, silent success | Yes, 2,363 rows with the new column | n/a | Low |
| schema-drift5 | [All four at once](observations/schema-drift5-combined.md) | all of the above | Yes, on the first missing column only | Nothing | No. "Replaced" 6 nodes; the same code still ran | Medium |
| semantic-drift1 | [Cents → dollars](observations/semantic-drift1-cents-to-dollars.md) | `253.9` → `2.539` | Yes, "DataFrame should not be empty" at dedup; nothing about units | Nothing | No. Inspected the wrong file and blamed `Brand` | High |
| semantic-drift2 | [Dates as MM/DD](observations/semantic-drift2-date-mmdd.md) | `17/09` → `09/17` | No, silent success | Yes, and *more* correct than the baseline | n/a | Low |

**Semantic drift: did my validation catch it?** Cents → dollars: yes (no output, where my rules expect 38 rows). MM/DD: it flagged a big mismatch, but on the wrong side. My DD/MM rule doesn't fit a month-first file, and the answer key shows every row Rhombus wrote is right ([details](observations/semantic-drift2-date-mmdd.md)). Rhombus noticed neither change in meaning.

### Top three findings

1. **The chatbot didn't fix anything by itself (0 of 5 failing cases), and twice it edited what it shouldn't.**
   - In schema-drift1 its fix landed on the **baseline** pipeline, not the failing copy, so the re-run hit the same error with the same `code_sha`.
   - In schema-drift5 it "fully replaced" six steps. The prompts changed, but the code that runs didn't.
   - In semantic-drift1 it inspected the wrong file (the one named in an old chat message), blamed a missing `Brand`, and cut `Brand` from a built-in dedup step.
   - When a fix did make a run pass (schema-drift3), it changed the rule: four invalid postcodes came out as a plausible `2999`, with a green run.

2. **Green runs can carry wrong data, and the useful warnings are easy to miss (Critical).**
   - The baseline silently swaps day and month on 733 dates, because Rhombus guesses dates are month-first at import.
   - A new column (schema-drift4) flows into the cleaning steps and GCS without a word.
   - When a step empties the table, the error names a later step ("DataFrame should not be empty" at dedup). The right step is flagged only on a canvas card, which covers the newest log entry and can't be closed.
   - My validation, and diffing against the baseline output, caught all of these.

3. **The schedule keeps going, but it can't see upstream changes, and changing its input breaks it.**
   - The imported file is a snapshot, so a changed source is "Skipped… unchanged data".
   - Switching the input wipes the built-in steps' settings and the output destination.
   - It does record failures and retries them every 5 minutes. After a long run of failures it turned itself Inactive with no notice.
   - In schema-drift5, a scheduled run and a manual run a minute apart ran different code.

Also from the API tests ([details](api-tests/README.md)):
- Imported datasets store the full presigned S3 link, signature and access key id included, readable by anyone on the project.
- A lowercase `bearer` scheme gets past the 401 check but then returns an empty project list, and a 500 error page on the project endpoint.
- Some things held up well. Every forged-token variant (including `alg:none`) gets a 401, another org's project is a 404 on every endpoint I tried, and odd IDs get a clean 404/422 with no stack traces.

---

## 3. Usability feedback

**What I liked.** When it works, the AI builder is fast: one prompt with nine numbered rules gave me a nine-step pipeline, and the canvas makes it easy to see what each step does. The outputs are deterministic (the same input always gave the same file), which made testing fair. When a column is missing, the error names the node and the column. "Ask Chatbot" on a log error is a good idea.

**What was frustrating.** Most of my time went into things around the pipeline, not the pipeline itself:
- **During setup**, the S3 connector failed with a misleading error, and importing a CSV from a link failed ("no markdown table was found").
- **The logs** print "Pipeline failed" and "completed successfully" in the same second. The most useful warnings ("No results found…") are popups that vanish. Scheduled runs don't show up in Logs at all.
- **The chatbot's** edits don't always change the code that runs, and the only clue is an unchanged code ID in the error. It also reads its own old chat history as if it described the current input.
- **Small things add up.** There's no way to copy a pipeline or a node (the builder can't set code), the model choice resets to the default on every page load, destinations have to be re-added per project, the builder can't set the destination it just created, and automated browsers get an "Ad Blocker Detected" popup that blocks clicks.

**What would help most.**
1. Show the row count each step outputs, and warn or fail when a run writes 0 rows.
2. Check the incoming schema and date format at import, and say what you guessed.
3. Make a chatbot fix visibly regenerate the code (or say it didn't), and re-run the failing step before claiming it's fixed.

Day-to-day friction is in the [friction log](docs/setup/03-rhombus-pipeline.md#friction-log).

---

## 4. Demo video
**[Watch on Vimeo](https://vimeo.com/1238992218)**. A 3-minute walkthrough of the UI tests, API tests and data validation: setup, where credentials go, how to run each suite, and what you'll see. Captions, no voiceover.

---

## 5. Observability dashboard (bonus)
**[bluezed15.github.io/rhomb/dashboard](https://bluezed15.github.io/rhomb/dashboard/)** is one interactive page with the four views the brief asks for:
- **Pipeline health**: every run of the baseline and each case, succeeded vs failed, with my validator's verdict at the end of each bar. Click a bar to list its runs. Setup runs (resetting the drift copy) are left out.
- **Output consistency**: every setup's repeat runs (3+ each) compared by sha256, or by where they failed when nothing was written. Below it, pick any two files and press Run for a side-by-side diff with the changed cells highlighted and a short note on what kind of change it is.
- **Capability heat map**: each case × what a customer needs (noticed it, clear error, right data, chatbot fix, schedule). Click a cell for the reason and the evidence.
- **Execution time**: a box plot per case, every run a dot, with the baseline as a reference.

Why I picked each chart is in [D15](docs/decisions.md#d15-a-different-chart-for-each-dashboard-view).

It's a static page built from [`rhombus-runs.csv`](data-validation/rhombus-runs.csv), [`consistency.csv`](data-validation/consistency.csv), the validator's [results](data-validation/results/) and the downloaded outputs. The heat map is my judgement per case. To view it locally, run `python -m http.server` in the repo root and open `localhost:8000/dashboard/`.

---

## 6. Judgement calls and trade-offs
The calls that shaped the results most. The rest are in the [decision log](docs/decisions.md).

| Call | Why | What it cost |
|---|---|---|
| **A presigned S3 link instead of the S3 connector** | The connector was denied inside Rhombus's own network, even with their exact policy | It's not the connector the brief asks for, and the import is a snapshot, so each drift file is imported once and a case switches the input ([D9](docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)) |
| **The baseline is its own pipeline, next to an exact copy** | So one case's chatbot fix can't leak into the next, and the baseline is never touched | Apply runs both pipelines, and resetting the copy before each case takes several re-runs. ([D6](docs/decisions.md#d6-the-baseline-is-its-own-pipeline-on-the-same-canvas)) |
| **A strict "fixed by itself" rule for the chatbot** | It's what matters to someone relying on it | Harsher than a patient user would be. It's applied the same way to every case ([D11](docs/decisions.md#d11-a-strict-rule-for-did-the-chatbots-fix-work)) |
| **Seven cases, three runs of each setup** | Every case the brief lists, and the 3 repeats the consistency view asks for | The chatbot ran once per case, so its answers aren't repeated ([D14](docs/decisions.md#d14-breadth-over-repetition)) |
| **Read-only API tests, bugs as expected failures** | Safe on a real account, and findings stay visible | Write endpoints aren't covered by the API suite ([D13](docs/decisions.md#d13-api-tests-are-read-only-and-known-bugs-are-written-as-expected-failures)) |
| **A separate test account for the automated tests** | Keeps my own login out of the tests | The UI journey still puts a presigned link and the GCS key into Rhombus, so I run it myself and keep the report ([D12](docs/decisions.md#d12-tests-run-on-a-separate-test-account-and-type-no-secrets-of-mine)) |

## Limitations and what was not tested
- **The chatbot was asked once per case.** It gives different answers each time, so its behaviour isn't shown to repeat.
- **Drift isn't a change in S3.** The import is a snapshot, so each case switches the input to a pre-imported file ([D5](docs/decisions.md#d5-each-drift-file-is-its-own-import-and-a-case-switches-the-input)). The schedule paused itself after 5 skips for unchanged data, so the repeats were run by hand.
- **My validator checks my rules, not ground truth.** That's fine for most cases, but it misjudged the MM/DD case, where Rhombus's guess happened to be right. I used the answer key there.
- **Outputs were downloaded by hand** from GCS (no read-only key), and [`runs.csv`](data-validation/runs.csv) says which file belongs to each case.
- **Free plan limits.** 3 projects and limited credits, so every case shares one project and one drift copy.
- **No load testing.** I didn't want to load-test a production service I don't own.

## Test reliability (flakiness)
Retries are off in [`playwright.config.ts`](playwright.config.ts), so a flaky step shows up as a failure instead of quietly passing on a second try.

| Suite | Known instability | Cause | How it's handled |
|---|---|---|---|
| UI | An "Ad Blocker Detected" popup appears at random and swallows clicks | Rhombus's tracking scripts don't load in Playwright's browser | A handler closes it whenever it appears, and the step it interrupted is retried as a whole |
| UI | The AI builder takes 1–3 min, and the first run after a build is slower | Code is generated per node on the first run | Waits on real signals (node count from the API, the newest log line), never fixed sleeps |
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
