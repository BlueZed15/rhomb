# Prompt 7: rebuild the baseline before schema-drift5

schema-drift4's chatbot had swapped the suburb and dedup built-ins for LLM nodes, so before schema-drift5 I put the input back to `Table 1.csv` (the baseline) and asked the builder to rebuild everything after the Data Input. Pipeline mode, Lattice. It's [prompt 6](06-rebuild-clean-baseline.md) with a "clear first" line in front and "connect to gcs_export" at the end:

```text
Clear every node after the Data Input (keep the Data Input and the gcs_export Data Output) and rebuild the cleaning pipeline from scratch for Table 1.csv, using built-in transformers where they fit and LLM nodes otherwise, one node per rule, in this order. 1) ... 9) [same 9 rules as prompt 6] ... Keep all 8 columns with their current names and order; do not add or remove columns. Connect the last node to gcs_export.
```

## Used again before semantic-drift1
schema-drift5's chatbot fixes left node 2 expecting `IsDiscounted`, so the pipeline failed on the baseline itself. I sent the same prompt again on `Table 1.csv`. This time the builder said every prompt would "declare the 8-column schema", and it wrote fixed code for the trickier nodes "so the code is deterministic rather than LLM-generated".
