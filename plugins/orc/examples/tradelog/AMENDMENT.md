# Amendment (owner, arrives after CHECKPOINT-1)

1. **Tags.** Native CSV gains an optional column `tags` (`;`-separated). Old files without it still import; MT5 trades
   have no tags. `stats --tag T` keeps trades carrying tag T (combines with `--from`/`--to`); `stats --by tag` groups by
   tag (a trade counts in each of its tags; untagged trades go to the group `untagged`).
2. **More statistics.** The stats object gains `avg_win_r` (mean R of wins), `avg_loss_r` (mean R of losses) and
   `sharpe_r` (mean R divided by the sample standard deviation of R, n − 1); each is `null` when it is undefined
   (no wins, no losses, fewer than 2 trades, or a zero deviation).
3. **Export.** `export --db DB --out FILE.csv` writes native CSV including `tags`, such that importing the file into an
   empty db gives byte-identical `stats --json` and `equity` output.

The trade formulas must not change. Update README, tests and the final report accordingly.
