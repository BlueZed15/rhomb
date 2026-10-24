# Decisions

The calls I made along the way, why, and what each one cost. Short on purpose. Where a call didn't work out as planned, I say so.

---

## D1. Playwright with TypeScript for the UI and API tests
It waits for things on its own, which makes "no fixed sleeps" easy, and one tool, login and report cover both suites.
The trade-off is that Cypress has a nicer interactive runner. I'd only switch if a team was already using it.

## D2. Python for data validation and the dataset
pandas is the most direct way to compare two CSVs and generate the drift files, and the checks stay easy to read.
The trade-off is a second language in the repo. In production I'd use something like Great Expectations, and read GCS directly instead of downloading files by hand (see the README's Limitations).

## D3. A separate, minimal identity for each job
Rhombus reads S3 through its own bucket policy, and writes to GCS with its own service account. My scripts use a separate IAM user with no delete permission. If one key leaks, it can only touch one bucket.
The trade-off is more setup and more keys to look after. I planned a read-only GCS account for the validator too, but didn't make it, so outputs were downloaded by hand.

## D4. Versioning on the S3 bucket
Every drift version is kept, so each run can point to the exact file it read ([runs.csv](../data-validation/runs.csv)).
Old versions take up space, but at this size that costs basically nothing.

## D5. Each drift file is its own import, and a case switches the input
My plan was to overwrite the same S3 file, because that's how drift really happens. But Rhombus's import is a one-time snapshot, so the schedule never sees a changed file: it just logs "Skipped… unchanged data". So I import every file once up front ([`import-inputs.mjs`](../scripts/import-inputs.mjs)), and a drift case is switching the drift pipeline's input to that file.
The trade-off is that it isn't quite an upstream change. It tests what the pipeline and the schedule do with a drifted file, not whether Rhombus notices the source changed (it doesn't).

## D6. The baseline is its own pipeline on the same canvas
The chatbot's fixes edit the pipeline, so after a case it isn't the baseline any more. So one canvas holds two pipelines: the baseline, reading `Table 1.csv`, which I never edit, and an exact copy that gets each drift file and the chatbot's fixes. The builder can't copy code, and when I asked it to make the copy it rewrote the baseline too ([prompt 7](prompts/07-drift-copy.md)). So I made the copy by pasting the baseline's code into each step, and I reset it the same way before every case. Each case starts with a pre-check: the copy's output has to be byte-identical to the baseline's.
The trade-off is time. Apply runs both pipelines, and switching the input wipes the copy's built-in settings, so every reset is several re-runs.

## D7. Datasets come from a seeded script
Anyone can regenerate them, and "only one thing changed" is provable in code.
The trade-off is that it's slower than editing a spreadsheet, and the mess is mine, so it only reflects what I thought to break.

## D8. Predictions written before each drift run
Each write-up has a "What I expected" section I wrote before running the case, so wrong guesses stay visible.
The weak spot here is proof. I planned to commit each prediction first so git timestamps would show the order, but I didn't commit during the work, so you're taking the order on trust.

## D9. S3 through a presigned URL instead of the S3 connector
The S3 connector kept getting denied on Rhombus's side, even with their exact policy ([write-up](../observations/setup-s3-source-connection.md)). So the data stays in the same private bucket, and Rhombus reads it through "From Web URL" using a short-lived presigned link, signed by [`import-inputs.mjs`](../scripts/import-inputs.mjs). A link to the CSV failed ("no markdown tables were found"), so I serve the same data as `.xlsx`, which it reads fine.
The trade-off is that it's not the connector the brief asks for, and the import is a snapshot ([D5](#d5-each-drift-file-is-its-own-import-and-a-case-switches-the-input)).

## D10. NSW FuelCheck fuel prices as the dataset
I wanted real Australian data where the drift cases make sense. It's [published monthly by NSW Fair Trading](https://data.nsw.gov.au/data/dataset/fuel-check) under CC BY-SA. Prices are in cents per litre, so a feed switching to dollars is a believable mistake. Dates are DD/MM, so a US-style export is a real risk too.
The trade-off is that real data has quirks I had to learn first (e.g. a NSW postcode starting with 3). I also considered a made-up café dataset, UCI Online Retail, and NSW property sales.

## D11. A strict rule for "did the chatbot's fix work?"
It only counts if the chatbot fixes the problem by itself from the pasted error. If it needs me to point at the cause, or several prompts, that's a no.
The trade-off is that it's harsher than how a patient user would rate it. But it's the question that matters for someone relying on the chatbot, and it's applied the same way to every case.

## D12. Tests run on a separate test account, and type no secrets of mine
The tests log in with an email-and-password test account entered at the prompt, never stored. GitHub and Google sign-in block automated browsers anyway.
The trade-off is that the UI journey still has to put a presigned link and the GCS key into Rhombus, because that's the journey. So I run it myself and keep its report as evidence, and reviewers can run it with their own accounts via `.env`.

## D13. API tests are read-only, and known bugs are written as expected failures
Every API call is a GET, so nothing on a real account changes. Bugs I found are tests marked "expected to fail": the suite stays green, and they flag the day Rhombus fixes them.
The trade-off is that write endpoints (create, delete, run) go untested by the API suite. The UI journey covers creating things.

## D14. Breadth over repetition
Seven drift cases, each setup run 3 times, and the chatbot asked once per case. Repeating a setup is cheap (▶ twice); repeating the chatbot means resetting the drift copy after every answer.
The trade-off is that the pipeline's behaviour is shown to be repeatable, but the chatbot's isn't, and it gives different answers each time.

## D15. A different chart for each dashboard view
I picked each chart for the question that view answers.
- **Pipeline health** is a horizontal stacked bar per case. Bars compare counts better than a pie, and horizontal leaves room for the case names and my validator's verdict.
- **Output consistency** is a table plus a side-by-side diff. "Same or not" is a yes/no, so a sha256 answers it exactly (or, when nothing was written, the step and error it failed with). The diff shows only the cells that changed, so the 733 swapped dates stand out, and a short note says what kind of change it is.
- **Capability heat map** is a grid of case × what a customer needs, on one dark-to-bright scale that also works for colour-blind readers.
- **Execution time** is a box plot with every run as a dot. With 3–8 runs per case, an average would hide the spread, and a line would suggest a trend that isn't there.

The trade-off is that the heat map scores are my judgement, not measurements, so every cell links to the write-up behind it.
