# Mission: tradelog — a trade-journal analytics CLI

Build `tradelog`, a Python 3.11 standard-library-only command-line tool that imports closed trades and reports honest
statistics about them.

Repository: `~/orc-examples/tradelog/` (the orchestrator creates it; `git init`; commit as you go). No third-party
packages, no network, no writes outside the repository except scratch under your own temp directory.

Work in small pieces: one work order covers one module or one command (roughly 150 lines of product code at most), each
with its own tests. The owner reviews history by work order.

## Data
The journal is one JSON file, the "db", named by `--db PATH` on every command that reads or writes it (default
`./tradelog.json`). Trades are stored with times normalised to `YYYY-MM-DDTHH:MM` (seconds dropped).

### Native CSV (`import FILE`)
Header required; columns in any order: `id,symbol,side,entry_time,exit_time,entry,exit,stop,qty,setup,fees`.
- `id` non-empty and unique; `side` is `long` or `short`; times `YYYY-MM-DDTHH:MM` with optional `:SS`;
  `entry exit stop qty fees` decimal numbers; `qty > 0`; `fees >= 0`; long needs `stop < entry`, short needs
  `stop > entry`; `exit_time >= entry_time`.

### MT5 history CSV (`import FILE --format mt5`)
Header `Ticket,Open Time,Type,Volume,Symbol,Open Price,S / L,Close Time,Close Price,Commission,Swap,Profit`.
Mapping: `id = "mt5-" + Ticket`; `Type` buy → long, sell → short; times `YYYY.MM.DD HH:MM:SS`; `qty = Volume`;
`entry = Open Price`; `stop = S / L`; `exit = Close Price`; `fees = -(Commission + Swap)` (may be negative here);
`setup = "mt5"`; `Profit` is ignored. A row with `S / L` = 0 has no stop and is invalid. Other rules as native.

## Derived values per trade
- `R = (exit - entry) / (entry - stop)` for long, `(entry - exit) / (stop - entry)` for short.
- `pnl = (exit - entry) * qty - fees` for long, `(entry - exit) * qty - fees` for short.
- Win: `pnl > 0`; loss: `pnl < 0`; `pnl == 0` is neither (it still counts as a trade and breaks a losing streak).
- Order: by `exit_time`, then `id`.

## Commands
- `import FILE [--format native|mt5] --db DB`: validates every row first; if any row is invalid nothing is written,
  exit 4, and stderr has one line per bad row: `line N: <reason>` (N counts the header as line 1). Rows whose id is
  already in the db are skipped. Prints exactly `imported X, skipped Y`. Creates the db if it does not exist.
- `stats --db DB [--json] [--by setup|symbol|weekday|month] [--from YYYY-MM-DD] [--to YYYY-MM-DD]`: `--from`/`--to`
  filter on the exit date, inclusive. JSON object keys: `trades wins losses win_rate avg_r expectancy total_pnl
  profit_factor max_drawdown longest_losing_streak` where `win_rate = wins/trades`, `avg_r` = mean R,
  `expectancy` = mean pnl, `profit_factor` = sum of winning pnl / |sum of losing pnl| (`null` when there are no
  losses), `max_drawdown` = the largest drop of cumulative pnl below its running peak, the curve starting at 0
  (a non-negative number), `longest_losing_streak` = longest run of consecutive losses in trade order. With no trades:
  counts 0, `total_pnl` 0, `max_drawdown` 0, the rest `null`. JSON numbers are not rounded. With `--by K` the JSON is
  `{"by": K, "groups": {key: <the object above>}}`, keys: the setup, the symbol, `Mon`..`Sun` of the exit date, or
  `YYYY-MM` of the exit date. Text output: one `key: value` line per statistic.
- `equity --db DB --out FILE.csv`: header `exit_time,id,pnl,cum_pnl,drawdown`, one row per trade in order,
  numbers with two decimals, `drawdown` = running peak minus `cum_pnl`.
- `daily --db DB [--json]`: per exit date: JSON list of `{"date", "trades", "pnl", "cum_pnl"}` ascending.
- `size --balance B --risk-pct P --entry E --stop S [--step Q]`: prints JSON `{"units", "risk", "risk_per_unit"}`
  with `risk = B * P / 100`, `risk_per_unit = |E - S|`, `units = floor(risk / risk_per_unit / Q) * Q` (Q default 1).
  Exit 2 when `E == S` or B, P or Q is not positive.
- `report --db DB --out FILE.md`: markdown with `# Trade report`, `## Summary` (a table of the statistics, money with
  two decimals) and `## By setup` (one table row per setup).
- Exit codes: 0 ok; 2 usage (no command, unknown command or flag, bad flag value); 3 a named file or the db cannot be
  read (a command that reads the db fails with 3 when it does not exist); 4 invalid CSV data.
- `stats --json` over a db of 200,000 trades finishes in under 5 seconds on this machine.
- `README.md`: every command, the CSV formats, the formulas, exit codes, known gaps, honestly.

## Done means
1. `python3 -m unittest discover -s tests` passes; fixtures cover long and short trades, a breakeven trade, an invalid
   CSV and an MT5 export.
2. Every command behaves as specified through the CLI (the owner's acceptance suite drives the CLI only).
3. The performance bound holds, measured once.
4. README as above.
5. Final report at the path the orchestrator was given: built, verified (commands), deviations, gaps, per-builder
   account, resumes.

## A spec change will arrive mid-mission
Expect one amendment after the first integrated version. Keep the trade formulas in one place.
