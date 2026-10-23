# Demo video

A **3-minute walkthrough of the UI tests, API tests and data validation**: what you need, where each credential goes, how to run each suite, and what you'll see. There's no voiceover; captions do the explaining.

It's generated, not screen-recorded. [`scripts/make-demo-video.mjs`](../scripts/make-demo-video.mjs) lays out each scene from the repo's own files (`.env.example`, test output, validation reports), plays them in a browser and records that with Playwright. No real credential appears: the login prompt shows `you@example.com`.

```bash
node scripts/make-demo-video.mjs        # writes demo-video/rhombus-demo.webm (gitignored)
```

## Adding real footage of the UI test (optional)
```bash
npm run test:ui -- --fresh --record     # keeps a video of every test
node scripts/make-demo-video.mjs        # splices in steps 1, 3 and 5
```
Only three steps are spliced in: the new project, the AI builder building the pipeline, and the schedule. Steps 2 and 4 type a signed S3 link and the GCS private key into Rhombus, so the video **never includes them**, and says so on screen. The account email in the corner of Rhombus's screen is covered.

## Scenes
1. **Setup**, covering what you need · one-time install · where each credential goes · the `.env` file · the first-run login prompt
2. **API tests**, covering what each test checks (and which endpoint) · the run, and how to open the report
3. **UI test**, covering before you run it · its five steps and what each asserts · the run, including `--fresh` and `--record`
4. **Data validation**. Give it the input and output files, and it reports the differences (with the baseline's swapped dates as the example) · what it checks, with the cents → dollars run failing
5. Where to find more detail

## Uploading
The output is a `.webm`, which YouTube and Google Drive both accept. Upload it as **unlisted** (YouTube) or **anyone with the link** (Drive), then put the link in the README's [demo section](../README.md#4-demo-video).
