# schema-drift2 (Part 2) · Rename a column (`Price` → `PriceCentsPerLitre`)

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift2` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/schema-drift2-rename-column.json) |
| Change | `Price` is renamed to `PriceCentsPerLitre`. Same values, same position. |
| Pipeline before run | **Effectively the baseline.** schema-drift1's chatbot fix had only rewritten `brand_case_fix`'s prompt, and its code stayed the same (`code_sha` unchanged). This run failed at node 2, before reaching that node anyway. |
| Stopped? | **Yes**, at `drop_empty_price_fuelcode` (node 2) |
| Reached GCS | Nothing |
| Chatbot fix worked? | **No.** The diagnosis was right this time, but the code didn't change. |
| Severity | **Medium** (fails clearly, but the chatbot's fix doesn't work) |

## What I expected (written before the run)
`drop_empty_price_fuelcode` checks for `Price` first, so it should **stop at node 2** with "Column 'Price' does not exist". What I'm really curious about is the chatbot: will it suggest renaming the column back (the right fix), or rewrite every node that uses `Price`?

## What happened
Same pattern as schema-drift1. I re-imported the link (now serving the renamed file), and selecting it started a run (14:17:40), which stopped where I expected:

```text
Pipeline failed at drop_empty_price_fuelcode: LLM execution failed (code_sha=d94632983ed0):
Column 'Price' does not exist in input_df_1! --- Generated code --- ...
```
([screenshot](evidence/drift/04-schema-drift2-price-missing-error.jpg)) Nothing reached GCS.

## The logs
The error names the node and the column, which is good. But again, the same second also logs "Pipeline execution completed successfully", followed by a dump of generated Python.

## The chatbot
I used **Ask Chatbot** on Lattice. This time it did better:

- The diagnosis was **correct**. It started with the same "different column names" guess, but then actually **opened the dataset** and found it: "There it is — the column is called `PriceCentsPerLitre`, not `Price`." It also checked `FuelCode` was fine.
- For the fix, it chose to rewrite the 3 nodes that reference `Price` (`drop_empty_price_fuelcode`, `price_clean`, and the dedup column list) rather than add one rename step at the start. That's more changes than needed, and it would silently carry the new name through to GCS.
- **Did it work? No.** The re-run at 14:20:45 failed with the **exact same error and the same `code_sha=d94632983ed0`** ([screenshot](evidence/drift/05-schema-drift2-fix-same-code-sha.jpg)). It reported "Modified pipeline ~3" but never said it was done, and the code that runs hadn't changed.

That's three out of three now (the baseline build, schema-drift1 and schema-drift2): the chatbot edits a node's prompt and the old code keeps running. You'd have to spot the unchanged `code_sha` or press "Regenerate Code" yourself to notice.

## The schedule afterwards
Still Active. Like schema-drift1, the actual run is triggered when the new input is applied, and the timed runs keep skipping with "unchanged data". The failure doesn't show up in the schedule's run history.

## What I think
Good error, good diagnosis (once it looked at the data), but the fix doesn't actually take effect, and it would have rewritten the pipeline around the drifted name instead of mapping it back.

## Reproduce
1. `python scripts/upload_dataset.py schema-drift2-rename-column`
2. Re-import a fresh link (`python scripts/presign_url.py input/fuelcheck.xlsx --copy`, then Data Input → From Web URL) → select the new table → Apply.
3. Logs → Ask Chatbot → Run.
4. `python data-validation/validate.py datasets/schema-drift2-rename-column.csv --no-output` (the run wrote nothing)
