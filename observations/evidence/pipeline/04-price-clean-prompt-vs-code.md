# price_clean: the instruction vs the code that runs

Captured 2026-10-22 from the node's **Transform → Edit Prompt / Edit Code** panel, after prompt 3 (Lattice's "fix").

Lattice's reply said the fix means the node "no longer resets the index, which previously broke alignment with the mask". The rewritten **instruction** says the same thing. But the **code** wasn't regenerated (the panel has a separate "Regenerate Code" button), and it still resets the index.

## Instruction (after prompt 3), step 7
> 7. Do NOT reset the index — keep the original index alignment so the mask stays consistent.

## Code (what actually runs)
```python
# Start with input dataframe
output_df = input_df_1.copy()

# Step 1: Remove trailing 'c' from Price column
# Handle both string and numeric types
output_df['Price'] = output_df['Price'].astype(str).str.rstrip('c')

# Step 2: Convert Price to numeric (float)
# Use errors='coerce' to convert non-numeric values to NaN
output_df['Price'] = pd.to_numeric(output_df['Price'], errors='coerce')

# Step 3: Drop rows where:
# - Price is NaN (couldn't be converted)
# - Price < 100
# - Price > 400
output_df = output_df.dropna(subset=['Price'])
output_df = output_df[(output_df['Price'] >= 100) & (output_df['Price'] <= 400)]

# Reset index after filtering to maintain continuity
output_df = output_df.reset_index(drop=True)

# Create output mask: mark all cells as False (no new cells created, just filtered/cleaned)
# Start with input mask and reindex to match output shape
output_mask = input_mask_1.reindex(index=output_df.index, columns=output_df.columns, fill_value=False).astype(bool)

# Mark Price column as modified for all remaining rows (since values were cleaned)
output_mask['Price'] = True
```

For comparison, the `postcode_clean` node right before it keeps the original index and reindexes its mask to match, which is the pattern step 7 describes.
