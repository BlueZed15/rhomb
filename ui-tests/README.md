# ui-tests/

One Playwright test, [`pipeline-journey.spec.ts`](pipeline-journey.spec.ts), that walks the whole Part 1 journey in the browser, on a throwaway project in the test account.

Run it with `npm run test:ui` from the repo root, or `npm run test:ui -- --fresh` to redo every step.

| # | Step | What it asserts |
|---|---|---|
| 0 | Log in (shared [`auth.setup.ts`](../auth.setup.ts)) | The session returns a valid token |
| 1 | Create a project, or reuse an unfinished one (the Free plan allows 3) | The URL becomes `/workflow/<id>` |
| 2 | **S3 source.** Sign a 1-hour link to the baseline in S3 with your IAM key, then Data Input → From Web URL → Fetch → Review Tables → Import | "table imported successfully", and the input node shows the table |
| 3 | **AI-built pipeline.** One Pipeline-mode prompt with the 9 cleaning rules | The API shows ≥10 nodes (input, cleaning steps, output) |
| 4 | **GCS destination.** Open the output node, add GCS with your key file if the project has none, select it, run | The API shows a numeric `destination_id`, and the newest log line is "Pipeline completed successfully" |
| 5 | **Schedule.** Add a Daily schedule | The card shows "Schedule for…", "Active" and "Next run" |

**No fixed sleeps.** Every wait is on something real: a URL, a node count from the API, a log line, a button appearing.

**Done by hand on purpose** (the same as I did manually, and written up):
- The S3 connector is blocked, so the source is a presigned link ([D9](../docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)).
- The AI builder can't set a destination id, so the test picks it.

**Not done** are deleting the project or schedule afterwards (deleting is permanent), and reading the output file in GCS (that's [`data-validation/`](../data-validation/)).

Before running it, put the baseline in your bucket with `python scripts/upload_dataset.py baseline`, and fill in `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_SOURCE_BUCKET`, `RHOMBUS_GCS_KEY_FILE` and `GCS_OUTPUT_BUCKET` in `.env`. The test checks these first and stops straight away if one is missing.
