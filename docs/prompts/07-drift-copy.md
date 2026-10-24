# Prompt 7: add the drift copy next to the baseline

Sent 2026-10-23 18:38 in project `fuelcheck-drift`, **Pipeline** command, **Lattice**. The idea was a second pipeline on the same canvas that gets each drift file and the chatbot's fixes, while the `base_` pipeline stays untouched ([D6](../decisions.md#d6-the-baseline-is-its-own-pipeline-on-the-same-canvas)).

```text
Add a second, separate pipeline on this canvas that is an exact copy of the base_ pipeline, for drift testing. Do not change, delete or connect to any base_ node. The copy: a new Data Input node reading the dataset Table 1 (1).csv, then one node for each base_ cleaning node in the same order (base_whitespace_trim, base_drop_empty, base_fuelcode_map, base_brand_normalise, base_suburb_titlecase, base_postcode_clean, base_price_clean, base_date_format, base_dedup), each with the same node type and exactly the same parameters: for LLM nodes copy the prompt AND the existing code character for character with mode set to code, do not regenerate or rewrite anything; for built-in nodes copy the same settings. Then a new Data Output node exporting CSV to the Google Cloud Storage destination rhom-1. Name the new nodes with a drift_ prefix instead of base_ (drift_input, drift_whitespace_trim, ..., drift_output).
```

## What it did (5 min 28 s)
- It copied the prompts but **not the code**. It tried, found "the compiler doesn't accept code and mode during add_node", and left the LLM nodes to write their own code on the first run. So the copy wouldn't have run the same code as the baseline.
- It **rewrote the baseline** it was told not to touch: all seven `base_` LLM steps' code, the first step's prompt, and the baseline output (destination turned back into a name, filename dropped). Its summary said "No base_ node was modified".

I restored the baseline from a snapshot I'd saved before sending this, and pasted the baseline's code into each `drift_` step by hand. At 20:44:58 both pipelines wrote byte-identical files (`503fd6ed…`).

This prompt also named `Table 1 (1).csv` as the drift input. The chatbot kept naming that file in later cases, long after the input had changed.
