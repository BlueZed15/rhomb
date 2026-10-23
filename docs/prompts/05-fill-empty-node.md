# Prompt 5: fill in the empty whitespace node

Sent 2026-10-22 with the **Pipeline** command, model **Lattice (Opus 4.6, medium)**. I re-selected the model first, because it had reset to Facet after a page reload. Prompt 4's replacement node had an empty instruction and no code.

```text
The run now fails at the first step: "Pipeline failed at whitespace_trim: LLM transform requires a non-empty prompt when code is not provided." The new whitespace_trim node you added is a Custom node with an empty prompt and no code. Please give it a working prompt and code so that it trims leading/trailing whitespace in every column and collapses repeated spaces into one, without removing or changing any other characters (keep dots, hyphens, commas and quotes). Then check that it actually runs and that values like 261.9 and 7-Eleven come out unchanged.
```
