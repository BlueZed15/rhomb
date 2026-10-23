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

## D5. Drift goes in by overwriting the same file
That's how drift really happens, when something upstream changes a file you already read. Uploading a new file name would test something else.
The risk here was Rhombus caching the file, so runs would read old data. It did. The import is a one-time snapshot, so the schedule never saw the new file (finding #3 in the README). Each drift case had to be re-imported by hand.

## D6. Every drift case starts from the same verified baseline
A chatbot fix for one case mustn't leak into the next. Rhombus can't duplicate a project, so after each case I rebuilt the pipeline from the same prompt and checked its output was byte-identical to the original before moving on.
The trade-off is credits and time. I learned why it matters the hard way, when my first schema-drift3 attempt inherited schema-drift2's changes and I had to redo it ([schema-drift3-change-type](../observations/schema-drift3-change-type.md)).

## D7. Datasets come from a seeded script
Anyone can regenerate them, and "only one thing changed" is provable in code.
The trade-off is that it's slower than editing a spreadsheet, and the mess is mine, so it only reflects what I thought to break.

## D8. Predictions written before each drift run
Each write-up has a "What I expected" section I wrote before running the case, so wrong guesses stay visible.
The weak spot here is proof. I planned to commit each prediction first so git timestamps would show the order, but I didn't commit during the work, so you're taking the order on trust.

## D9. S3 through a presigned URL instead of the S3 connector
The S3 connector kept getting denied on Rhombus's side, even with their exact policy ([write-up](../observations/setup-s3-source-connection.md)). So the data stays in the same private bucket, and Rhombus reads it through "From Web URL" using a 7-day link from [`presign_url.py`](../scripts/presign_url.py). A link to the CSV threw an error saying no markdown tables were found, so I serve the same data as `.xlsx`, which it reads fine. It's the closest I could get to the brief, and it works today.
The trade-off is that it's not the connector the brief asks for, and the link expires after 7 days. It's also a snapshot, so each drift case meant re-importing the link rather than waiting for the schedule.

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
Seven drift cases run once each, instead of a few cases run several times.
The trade-off is that it shows each behaviour happens, but not how often. The chatbot in particular gives different answers each time.

## D15. A different chart for each dashboard view
I picked each chart for the question that view answers.
- **Pipeline health** is a horizontal stacked bar per drift case. The question is how many runs passed or failed for the baseline and 7 named cases, and bars compare counts better than a pie. Horizontal leaves room for the case names and for my validator's verdict at the end of each bar.
- **Output consistency** is a sha256 table plus a side-by-side table diff. "Same or not" is a yes/no, so a hash answers it exactly. When two files do differ, the diff shows them as tables, matches rows on the columns both files share, and shows only the columns that changed, so the 733 swapped dates in the baseline stand out instead of hiding in raw CSV lines.
- **Capability heat map** is a grid of drift case × what a customer needs, on one dark-to-bright scale (inferno). It's two sets of categories against each other, so a grid shows the pattern at a glance: stops loudly, rarely recovers. A single sequential scale reads as worse to better and still works for colour-blind readers.
- **Execution time** is a box plot with every run drawn as a dot. Most cases have 1–6 runs, so an average would hide the spread, and a line graph would suggest a trend over time that isn't there. The box only appears where a case has 3 or more timed runs.

The trade-off is that the heat map scores are my judgement, not measurements, so every cell links to the write-up behind it.
