# Changelog

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
