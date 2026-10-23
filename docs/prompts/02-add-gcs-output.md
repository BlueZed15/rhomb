# Prompt 2: add the GCS output

Sent 2026-10-22 with the **Pipeline** command, right after prompt 1. Prompt 1 built the 9 cleaning nodes but no output node, so I asked the AI builder to add it rather than wiring it up by hand.

```text
Add a Data Output node at the end of the pipeline, connected after the final de-duplication node (deduped_output). It should export to the existing Google Cloud Storage destination named rhom-1, in CSV format. Do not change any of the existing cleaning nodes.
```
