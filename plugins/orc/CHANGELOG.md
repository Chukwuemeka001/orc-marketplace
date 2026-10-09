# Changelog

## 0.22.0 — 2026-10-09
- The numbers beside the reading. The substrate writes `ops/orc/LEDGER.md` (and `ledger.json`, the durable
  accumulator) in the mission's repository on every event: returns with their check and boundary audit, marks, merges,
  verification requests and reports, integration runs, wakes, compactions, settle. Headline, stages (the windows between
  verification requests), children, verifications, integration runs and the orchestrator's own wakes, one section per
  version; nothing in it is the orchestrator's count. Both files are committed by pathspec before a verifier's snapshot
  is cut and when the mission settles.
- Three labels in every report: PROVED (the substrate's), CLAIMED (a child's report, named), READ (the orchestrator's
  sentence). The orchestrator never writes a PROVED figure: at each verification request and at settle the substrate
  stamps the `NUMBERS:` and `PROVED (ledger):` lines of `ops/FINAL.md` (the `NUMBERS:` line of the newest checkpoint)
  from the ledger and commits the report with the two ledger files in one commit, before the verifier's snapshot is cut
  (first proof of 0.22.0: three final rounds failed on figures the orchestrator had copied). `ops/FINAL.md` starts with
  `STATUS:`, `READING:` and `NUMBERS:` and has a `## Numbers` section with a `CLAIMED (reports):` and a `READ:` line; a
  final request without them is refused naming the missing line, a checkpoint without `NUMBERS:` is warned about in the
  receipt. The final verifier checks that the stamped lines equal the ledger's headline and fails the report only for a
  figure that contradicts the ledger; a figure that matches, or cites a CLAIMED report, needs no label.
- The intake is in the ledger: the main session's requests, tokens and minutes from `/orc begin` to the launch are
  frozen at launch, shown as `intake: …` under the wakes, counted in the headline total and the orchestrator's share
  (`… of which intake 0.67M`); a mission launched elsewhere reads `intake: not recorded in this session`.
- A verifier's report is parsed by the substrate (`VERDICT:`, `CRITERIA:` PASS/FAIL/N/A lines, `DEFECTS:`); the counts
  go in the ledger, never retyped by the orchestrator.
- What you see at the end: four lines (status · PROVED · READ · ledger) in the pane, the toast (first two), `/orc status`
  and `/orc resume`. While it runs, the pane shows the live PROVED line, in yellow when the stage so far ran no
  registered check.
- `/orc continue` adds a version section to the ledger; archiving a previous run leaves it in place. Merges record
  their commit; the main session's turns record why a wake came and what it cost.
- `/orc status` on a finished mission prints the four lines; while a mission runs it prints the live PROVED line.
  Toasts and log lines no longer carry a second `orc:` (the engine leads them with the plugin's name). The inbox's idle
  door admits one caller at a time, so a turn's end and the tick can no longer submit the same wake twice.
- Attempt history (second proof of 0.22.0: a child redone and steered lost its first check and its redo mark, the ledger
  said "checks 2/4 · 0 redo" where five checks ran and one redo was marked, and the report was made to agree). A child
  keeps every check run and every mark (`checks`, `marks`; `checkResult` and `mark` stay the latest). The Children table
  shows them (`FAIL 1s → PASS 1s (2 runs)`, `redo → accepted: "…"`) with an `attempts` column; the headline, the stage
  table, the live line (`6 returned (7 attempts)`) and the done lines count checks over all runs and redo / rejected over
  all marks ever recorded; `ledger.json` merges the histories by time, so a resumed session never shrinks them.
- Settle timing: the mission settles only when no main-session turn is open, at the end of the turn that wrote `STATUS:`
  (after its tokens are on the orchestrator's row and its wake is in the ledger), so the settle ledger includes the
  closing turn (the second proof lost it: 627,797 tokens, 8.55% of the orchestrator's). The done line's verdict is the
  last final verification's VERDICT and commit (`mission v1 DONE · PASS at 89eb0a4 · 11m13`), the STATUS text only
  without one, never "DONE · DONE". `/orc` answers `pane open.` without an `orc:` of its own; the live line shows the
  last known context, not `ctx 0`, at a wake's first step.

## 0.21.0 — 2026-10-09
- `/orc continue <request>` (and the orchestrator's `mcp__orc__continue`): a finished mission continues with your next
  request under the understanding, rules and directives you approved, with no new interview or gate. The previous
  run's records move to `ops/history/`; builders, checks, verifiers, merges and the pane come back. Works for missions
  started by the interview and for missions started from a mission file.
- A finished mission loaded in a session tells the orchestrator to use `continue` rather than orchestrate by hand;
  `mcp__orc__status` on a finished mission says the same.
- `UNDERSTANDING.md` lists continuations and, for mission-file missions, the file it started from.

## 0.20.x — 2026-10-08
- The orc computer (preview): `/orc computer on|off` writes sandbox settings from the approved plan; "Use the
  computer first" at gate 2; a Computer line on the gate-2 card, the pane and `UNDERSTANDING.md`.
- A default browser for everyone (Playwright MCP through npx, driving the installed Chrome, Canary or Edge); workers
  granted a browser at gate 2 run as `orc:builder-web` / `orc:verifier-web` and get only the safe browser tools.

## 0.19.x — 2026-10-08
- Browser access granted per worker role at gate 2 and proven by orc at launch (a local page at 375 px) before
  anything is dispatched; local pages only.

## 0.18.0 — 2026-10-08
- Gate 2 lists every tool or access the work will use (`capabilities`); the orchestrator tries each once at the
  start, so a permission prompt comes while you are still there.

## 0.17.x — 2026-10-08
- The orchestrator can steer a child (`mcp__orc__steer`): a running child reads the message with its next tool
  result; a finished child is resumed with it.
- Guards read commands, not quoted text; checkpoint verifiers check only the scope the orchestrator wrote.

## 0.16.x — 2026-10-08
- Gates you cannot miss: a question dialog, an ACTION NEEDED card at the top of the pane, a chip above the prompt.

## 0.15.x — 2026-10-07/08
- First release candidate: self-contained plugin (planner and guide bundled), workers read the project's CLAUDE.md,
  read-only access to orc's own folders without a dialog while a mission runs, a stall fix, smoke tests.
- Never the home folder as a project; `/orc begin` alone starts the conversation; verifiers get the mission files in
  their snapshot; orc's data folder follows `CLAUDE_CONFIG_DIR`.
