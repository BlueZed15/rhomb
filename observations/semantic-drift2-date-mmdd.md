# semantic-drift2 (Part 3) · Dates switch to US format (MM/DD)

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Case ID | `semantic-drift2` ([runs.csv](../data-validation/runs.csv)) · [validation](../data-validation/results/semantic-drift2-date-mmdd.json) |
| Change | `PriceUpdatedDate` is written month-first: `17/09/2026` → `09/17/2026`. |
| Pipeline before run | The same verified baseline pipeline as semantic-drift1. No chatbot was used in semantic-drift1, so it was untouched. |
| Does Rhombus notice? | **No.** No warnings, and "Pipeline completed successfully" (19:09:31). |
| Reached GCS | **Yes**, 2,363 rows. And the dates are **more correct than the baseline's**. |
| Does our validation catch it? | **Partly.** It flags a big mismatch, but its own "expected" output is the wrong one here (see below). |
| Severity | **High** (silent; on real Australian data the same parser gets 733 dates wrong) |

## What I expected (written before the run)
This one has a twist. Rhombus already parses dates month-first when it imports a file. That's why 733 baseline dates came out swapped. So a US-format file should be read **correctly**, and I expect this drifted run to have *fewer* wrong dates than the baseline. Rhombus won't notice anything either way, and the run should succeed.

## What happened
Exactly that. The run went straight through with no warnings at all ([screenshot](evidence/drift/26-semantic-drift2-clean-success-no-warnings.jpg)). The output is the same size as the baseline (283,447 bytes) and identical in every column **except 733 dates**, which are now right:

| | Baseline output (DD/MM input) | semantic-drift2 output (MM/DD input) |
|---|---|---|
| A station updated on 5 Sept | `09/05/2026` (reads as 9 May) ❌ | `05/09/2026` ✅ |

Against the real answer key ([baseline_expected.csv](../datasets/baseline_expected.csv)):

| | Correct rows | Missing | Wrong |
|---|---|---|---|
| Baseline | 1,630 | 771 | 733 |
| **semantic-drift2 (US dates)** | **2,363** | 38 | **0** |

The only misses are the 38 `219.9c` prices that Rhombus loses at import in every run.

## What our validation says
- `validate.py` compares the output with *our* cleaning rules applied to the input. Rule 8 assumes the source is DD/MM, so on a US file the "expected" output is itself wrong. It reports 82 matches and 2,281 unexpected rows. So it **does flag that something changed**, loudly, but at first glance it points the wrong way.
- The semantic checks don't trip either: every output date is a valid DD/MM date in September, because Rhombus parsed it correctly.
- Checking against the baseline answer key (same underlying data) shows the real story above.

So our validator catches **that** the dates changed, not **which side is right**. That needs a reference that doesn't depend on the input's format, like the answer key here, or a "dates must be in the source month" check on the *input*.

## The chatbot
Nothing failed, so there was nothing to give it.

## The schedule afterwards
This project has no schedule. A scheduled run would just be green.

## What I think
This is the flip side of the baseline's biggest bug. Rhombus guesses dates are month-first, so it gets US data right and Australian data wrong, and it never says it's guessing. Either way you get a green tick. For an Australian dataset (NSW Fair Trading), that's backwards. The fix on their side is to ask for, or at least show, the date format at import.

## Reproduce
1. `python scripts/upload_dataset.py semantic-drift2-date-mmdd`
2. Import a fresh link (`python scripts/presign_url.py input/fuelcheck.xlsx --copy`, then Data Input → From Web URL) → select the new table (`Table 1 (5).csv` for me) → Apply.
3. `python data-validation/validate.py datasets/semantic-drift2-date-mmdd.csv <downloaded output.csv>`
