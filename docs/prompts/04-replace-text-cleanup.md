# Prompt 4: replace the punctuation-stripping first node

Sent 2026-10-22 with the **Pipeline** command, model **Lattice (Opus 4.6, medium)**. After prompt 3's fix failed, I checked each node's code and preview myself (no credits) and found the real cause. This prompt gives the AI builder the correct diagnosis.

```text
I found the real cause of the empty output, and it isn't price_clean. The first node (whitespace_trim) is a Comprehensive Text Cleanup node that removes punctuation from every column, because Additional Retained Punctuation is empty. In the preview after it, Price 261.9 becomes 2619, 7-Eleven becomes 7Eleven, and commas and hyphens disappear from addresses. With every price about 10x too big, price_clean correctly drops all rows. Please replace whitespace_trim with a step that ONLY trims leading/trailing whitespace and collapses repeated spaces into one, and keeps every other character (dots, hyphens, commas, quotes) exactly as it is. Don't change the other nodes.
```
