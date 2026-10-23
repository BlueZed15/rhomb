# schema-drift4 (Part 2) · Add a column

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `schema-drift4` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/schema-drift4-add-column.json) |
| Change | A new column, `IsDiscounted` (Y/N), is added. Everything else matches the baseline. |
| Pipeline before run | The clean baseline (`fuelcheck-baseline`), after asking the builder to undo schema-drift3's `date_format` edit ([prompt 6, "Revert after schema-drift3"](../docs/prompts/06-rebuild-clean-baseline.md)). |
| Stopped? | **Yes, but not because of the new column.** Switching the input wiped the built-in nodes again, and the chatbot's "fixes" broke both nodes again before they worked. |
| Reached GCS | **Yes** (16:16:09): 2,363 rows **with** the new column. 57 rows fewer than expected (see below). |
| Chatbot fix worked? | **No.** It got the cleaning running again, but only after 4 prompts (each fix left an empty prompt that needed another one). |
| Severity | **High** (each chatbot fix caused the next failure, and it quietly restructured the pipeline) |

## What I expected (written before the run)
The LLM nodes loop over whatever columns exist, so they should carry the extra column through. Dedup lists columns by name, so it might ignore the new one. My guess is that it passes, and the extra column quietly reaches GCS.

## What happened
**1. The input switch wiped the suburb node again** (15:53:39, "missing 'columns'"), exactly like schema-drift3.

**2. The chatbot changed tactics.** It called it "a recurring issue" and **replaced the built-in Text Case node with an LLM node**. The next run failed with `LLM transform requires a non-empty prompt when code is not provided` ([screenshot](evidence/drift/19-schema-drift4-suburb-replaced-with-empty-llm-node.jpg)). That's the same empty-prompt mistake it made while building the baseline. One more prompt filled it in.

**3. Same story for dedup.** It was wiped (15:57:05), replaced with an LLM node "across all 8 columns" (this file has 9), failed with an empty prompt (15:58:14), and got patched on the next prompt.

The added column never caused an error. Everything else did. (I re-selected the GCS destination by hand afterwards; that's setup, not part of this test.)

## The logs
Each error names the right node this time. But they're all symptoms of the chatbot's own changes, and every one is still paired with "Pipeline execution completed successfully".

## The chatbot
- Its diagnosis was right about the wiped params ("params-lost-at-runtime pattern"), but it never says *why*: switching the input clears them.
- The fix **didn't work** by itself. Swapping built-ins for LLM nodes left empty prompts twice, so it took 4 chatbot prompts. It also changed the pipeline's structure (two built-ins are now LLM nodes), so the next case needs a rebuild.

## The schedule afterwards
This project has no schedule. On `drift1` the schedule skips on "unchanged data" and never sees any of this.

## What reached GCS
[Validation](../data-validation/results/schema-drift4-add-column.json): expected 2,458 rows (the new column makes some old "duplicates" distinct), got **2,363**.
- `IsDiscounted` went straight through to GCS. Nothing warned that the schema had changed.
- 1,630 rows match exactly, the same as the baseline. The 733 date swaps are the same known baseline issue, so the `date_format` revert held.
- **57 rows are missing** on top of the baseline's 771 (828 in total). That fits the chatbot's new dedup node, which dedups "across all 8 columns" and ignores the 9th. Rows that differ only in `IsDiscounted` got collapsed.
- The two output files from the two runs it started (16:15:54 and 16:15:58) are byte-identical.

## What I think
The drift itself was harmless. The new column flowed through, as I expected. The damage came from the "fix". To get round wiped settings, the chatbot swapped built-in nodes for LLM nodes, and the new dedup was written for the old schema. So a run that *passes* now silently drops 57 real rows, and nothing in Rhombus says so. Only the validator caught it.
