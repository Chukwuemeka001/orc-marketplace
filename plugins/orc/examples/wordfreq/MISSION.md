# Mission: wordfreq — a small, honest word-frequency tool

Build `wordfreq`, a Python 3.11 standard-library-only command-line tool.

Repository: `~/orc-examples/wordfreq/` (the orchestrator creates it; `git init`; commit as you go). No third-party
packages, no network, no writes outside the repository except scratch under your own temp directory.

## Behaviour
- `python3 -m wordfreq count FILE [FILE ...] [--json] [--min-len N]`: counts words (letters and digits, case-folded,
  apostrophes kept inside words) across the files; text output is one `word<TAB>count` per line, most frequent first,
  ties alphabetical; `--json` prints one object `{"files": N, "words": total, "unique": U, "top": [[word, count], ...]}`
  with the whole ranking in `top`. `--min-len N` ignores words shorter than N.
- `python3 -m wordfreq compare FILE_A FILE_B [--json]`: words whose rank differs between the two files, biggest rank
  change first; JSON shape `{"a": path, "b": path, "moved": [[word, rank_a, rank_b], ...]}`.
- Exit codes: 0 ok; 2 usage (no arguments, unknown flag, `--min-len` not a positive integer); 3 a named file is
  unreadable or contains no words at all (a file with words is fine even if `--min-len` filters them all: then `words`
  is 0 and exit is 0).
- A 10 MB text file counts in under 5 seconds on this machine.
- `README.md`: usage, exit codes, how words are defined, known gaps, honestly.

## Done means
1. `python3 -m unittest discover -s tests` passes and includes a fixture with punctuation, apostrophes, digits and
   mixed case.
2. The commands above behave as specified through the CLI (the acceptance suite drives the CLI only).
3. The performance bound holds, measured once.
4. README as above.
5. Final report at the path the orchestrator was given: built, verified (commands), deviations, gaps, per-builder
   account, resumes.

## A spec change will arrive mid-mission
Expect one amendment after the first integrated version. Keep the word definition in one place.
