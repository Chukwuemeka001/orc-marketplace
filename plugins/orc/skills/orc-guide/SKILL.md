---
name: orc-guide
description: Orchestration substrate for Claude Code (the orc plugin). Use when the owner wants to run a mission or project through orc, says "/orc", "orchestrate this", "run this as a mission", "owner intake", "understanding", "plan and rules", "resume the mission", "backlog", or "directive". Covers the interview-style intake with two owner gates, the main session acting as orchestrator, builders with clones, checks, boundaries, verifiers, integrator, and the durable state under <repo>/ops/orc/ that survives sessions.
---

# orc — how to behave in a session that has the orc plugin

## The owner intake is a conversation, not a form
1. The owner states a goal in their own words; `/orc begin <request>` (they type it) records it. If they typed
   `/orc begin` alone or just told you, ask what they want and in which folder, then call `mcp__orc__owner_context`
   with that folder as `repo` and start from there. Read the contract it returns; it is binding.
2. INTERVIEW first (grill-me discipline): restate the goal in your own words, say what you are unsure about, then ask ONE
   question at a time — the one whose answer changes the most — with 2–3 options and your recommended default marked and why.
   Research what you can (repo, commands, WebSearch/WebFetch) instead of asking the owner for findable facts; say what you
   found and what you assumed. Stop when answers stop changing the package (3–6 questions is typical).
   Before drafting, check coverage: inputs, every output (commands, reports, files, screens, with exact formats where
   other tools depend on them), error behaviour, scale and speed, where it lives and its dependencies, docs, and how the
   owner will judge it done. Ask about any uncovered category, then once: "Anything else you expect it to produce or do?"
3. GATE 1 — "is this what you mean?": draft mission + final picture + source evidence (supplied vs reported vs proposed,
   with coverage) via `mcp__orc__draft_understanding`; fix findings; present the owner's words next to your interpretation;
   call `mcp__orc__request_understanding`. The owner decides in the /orc pane (Approve / Correct / Defer) or `/orc approve`,
   `/orc correct <note>`, `/orc defer`. You cannot approve; there is no tool for it. Approval starts no work.
4. GATE 2 — "approve this plan and these rules?": draft plan nodes (runnable acceptance checks, dependencies, allowed
   paths), roles, execution policy and target, and `options[]` giving, for maxAgents, maxDurationMinutes, allowedEffects and
   allowedPaths, the chosen default, the alternatives and why. A format criterion must pin the exact shape. Present the plan
   and the rules; call `mcp__orc__request_permission`. That approval launches the mission by itself.
5. "Correct" comes with a note (owner_context shows it): change only that, keep the old item as a "correction" evidence
   item, request that gate again. After gate 2, a material change needs a new version (both gates again).

## Being the orchestrator (after gate 2; default mode)
- A prompt "orc mission (automatic)" hands you the working rules. Follow them exactly: commit scaffold + ops/CONTRACTS.md +
  work orders first; dispatch builders with the Agent tool (`orc:builder`, run_in_background true, prompt lines `CHECK:`,
  `CHECK_CWD:`, `MAY_CHANGE:`); end your turn after dispatching. The owner's maxAgents is enforced by the substrate.
- Act on "[orc wake]" prompts, not on raw task notifications. A wake is ordered the way you act: STATE (one line to
  re-orient), RETURNED, PROVED by the substrate (the registered check it ran, the boundary audit, the merge: never redo
  these), CLAIMED by the child (its report: judge it; spot-check only what the check does not cover), ALSO CHANGED,
  ACTIONABLE, RUNNING. Record every verdict with `mcp__orc__mark` (accepted merges the clone and removes it). Steer a child that is heading the wrong way with `mcp__orc__steer {taskId, message}`: a running one reads it
  with its next tool result, a finished one is resumed with it (e.g. a verifier about to fail work still being built). Pull state
  with `mcp__orc__status`. Children report in a fixed shape (builders: STATUS / CHANGED / CHECKED / NOT CHECKED /
  DEVIATIONS); put that shape in every work order.
- `mcp__orc__request_verification` at checkpoint and final. Its result says SPAWN NOW: spawn that verifier in the same turn
  (`orc:verifier`, run_in_background true, prompt = the named file). The integrator, and anything not yet done, arrives as
  an `[orc inbox]` block: as a prompt when you are idle, or attached to a tool result while you work. Every inbox item is
  binding: finish the current step, act on each item once (never spawn a second agent with the same description if
  `mcp__orc__status` shows it running), then continue. Never spawn a verifier or integrator unprompted.
- Write the final report as a PENDING draft before the final verification; flip the status only after a pass.
- Auto mode (optional): when a Workbench brief exists (or you write one), hand it to the substrate with
  `mcp__orc__run_graph {brief}`. It runs builders, checks, verifiers, merges and same-builder retries by the brief's
  policy, and pings you ("[orc graph]") only by that policy: an exhausted node, a gate reached, the graph done. Look
  with `mcp__orc__graph_status`; answer pings with `mcp__orc__graph_decide` (retry | skip | abort). Never mark graph
  children yourself. A failed node that cannot pass as planned is a planning defect: fix the brief and run it again.
  The owner can change the rules mid-run with `/orc policy retry=N parallel=N ping=…`.
  Integration in a graph run waits for the brief's integrator node: give it the path `ops/integration/` and it writes
  `ops/integration/check.sh` itself (otherwise the substrate's integrator writes it right after that node merges).
- Record standing owner rules stated mid-mission with `mcp__orc__directive`; they persist and show on resume.
- Never read directories named hidden*; never write outside the repository; never sweep-add or `commit -a`.
- Never edit the orc plugin's own files while a mission runs: the substrate denies it (a save would hot-reload the plugin
  mid-mission). If the owner wants it anyway, they type `/orc allow-edit`; you cannot.

## Durable state and resume
Everything lives in `<repo>/ops/orc/` (state.json, UNDERSTANDING.md, MISSION.md) plus `ops/DECISIONS.md`, `ops/FINAL.md`.
A new session in that repository is told a mission exists; `/orc resume` (or `mcp__orc__resume`) restores the intake at its
gate, or makes this session the orchestrator again with the snapshot's children adopted and a delta of what is pending.
`/orc backlog add <request>` queues the next goal; `/orc backlog next` starts its intake once the current mission is done.

## Other commands
`/orc start <mission.md> [archive=1|fresh=1]` runs a hand-written mission instead of an interview. `/orc understanding`
prints the package. `/orc` opens the pane.

## Limits to tell the owner
The session must stay open while a mission runs: orc acts through it (inbox items arrive as prompts when it is idle).
The project is a folder of its own, never the home folder; an empty one is fine. A hot-reloaded plugin keeps
an existing tool's first schema until a new session. Timing checks carry the machine load; a miss under load is "unmeasured".
