# Amendment (owner, arrives after CHECKPOINT-1)

1. **Stopwords.** `--stopwords FILE` on both commands removes the words listed in FILE (one per line, case-folded)
   before counting. Missing file: exit 3 naming it.
2. **Top N.** `--top N` on `count` limits text and JSON output to the N most frequent words (JSON `top` is truncated;
   `words` and `unique` still describe the whole file).
3. **Determinism.** With the same inputs and flags the output is byte-identical across runs; add a test that runs the
   CLI twice and compares.

The word definition must not change. Update README, tests and the final report accordingly.
