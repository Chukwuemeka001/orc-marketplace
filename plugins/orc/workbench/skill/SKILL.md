---
name: workbench
description: Use when planning multi-step or multi-agent work before any agent runs. Turns an agreed goal into a JSON work brief (decisions, phases, nodes, checks, verifiers, gates, retry and ping policy) and gets it through `workbench preflight`. Also use to preflight an orc gate-2 plan (`import-orc`).
---

# Workbench: plan the work before anyone runs it

The CLI is `python3.11 -m workbench` from the repo root (or `bin/workbench`). It only reads and writes brief files; it never runs a node or a check. Format of every key: README.md. Every check: docs/checks.md.

## 1. The method

Do the steps in order. Do not write nodes before steps 1-3 are done.

1. **Settle the goal.** Write it in the owner's words in `goal`. List what "done" means as `criteria` (`c1`, `c2`, ...), each testable. If the goal is unclear, ask the owner; do not guess.
2. **Find the decisions that are expensive to change** and decide them now: data formats, interfaces between parts, storage, permissions and effects (network, publication, spend). Put each in `decisions` with `reversibility` `hard` or `easy`. A `hard` decision must be `decided` before running (W15). Easy ones may stay `open`; they show up in `explain` for the owner.
3. **Split into phases. Plan only the next phase deeply.** Put it in `phase` (name, objective). Everything later goes in `later_phases` as `{name, goal, requires: [...]}`, where each requirement is an output path some current node produces or the id of a decided decision (W14). Do not put paths, checks or nodes in a later phase (W06): you have not learned enough yet.
4. **Write the nodes.** For each: `role` (`builder`, or `integrator` to combine builders' work), `work_type` (section 2), `objective`, `inputs`/`outputs` (files), `paths` (what it may write; independent nodes must not overlap, W01), `depends_on` (must include the node that outputs any of its inputs, W08), `check` (a runnable command, section 3), `verifier` (a different party than the builder), `effects`, `tools` (executables on PATH), `credentials` (name and kind only; never a value), `criteria` it delivers, `estimate_minutes`. Add one integrator that depends on every builder, a `checkpoint` gate after the risky first nodes, and a `final` gate after the integrator whose check tests the combined result, not one node. Set `policy` (section 3) and grant only the effects nodes use in `policy.allowed_effects`.
5. **Preflight and fix every block.** Run `python3.11 -m workbench preflight brief.json`. Each finding names the field and value to change. Edit the brief, re-run, repeat until `-> READY`. Use `--strict` to also clear warnings. Exit 0 ready, 1 not ready, 2 bad input. `--json` gives the same findings as one object.
6. **Owner reads `explain` and approves.** Run `python3.11 -m workbench explain brief.json` and show the owner: waves, critical path, gates, open decisions, and "Needs your approval" (non-local effects, credentials by name, tools). Optionally `graph` for a Mermaid diagram. Nothing runs until the owner approves.

Start a brief with `python3.11 -m workbench new brief.json` (a skeleton that fails preflight until you fill it in).

## 2. Work types and their verification

Set `work_type` on every node. The node's `check` and `verifier` must match it.

| work_type | verified by | the check must be |
|---|---|---|
| `code` | runnable tests | a command that exits non-zero when the code is wrong, e.g. `python3.11 -m unittest tests.test_x`. List the test file in the node's `outputs`/`paths`, or W03 blocks it. |
| `frontend` | a browser check | tests for what is static, plus a verifier who opens the page in a browser and tests named behaviours (specific inputs, expected text, no console errors, narrow-width layout). Write those behaviours into `verifier`. |
| `research` | every claim tied to a source | a command that fails if any claim lacks a source (e.g. each bullet must carry `[src: URL]`), plus a verifier who opens each source and confirms it says what the claim says. |
| `docs` | a reviewer against the facts | a command that runs the documented examples, plus a reviewer who compares every statement and number with the real behaviour. |

Checks must be commands, not sentences: "tests cover c1-c9" is prose and W03 blocks it. A check starting with `echo`, `true` or `:` proves nothing and is blocked (put the pipeline the other way round: `cmd | grep -q x`, not `echo y | cmd`).

## Profiles (version 2)

Write `"workbench_brief": 2` to declare, per node, how its work type is verified. `python3.11 -m workbench new brief.json --type frontend` (or `code`, `research`, `docs`) starts a version-2 brief with one node of that type and its profile fields empty. Preflight then blocks a frontend node without a browser check (W16), a research node without sources or a claims rule (W17) and a docs node without `checked_against` (W18). Version-1 briefs are unchanged. One page per profile, each with a worked example:

- [skill/profiles/code.md](profiles/code.md): runnable check (W03, W04)
- [skill/profiles/frontend.md](profiles/frontend.md): `browser_check` (W16)
- [skill/profiles/research.md](profiles/research.md): `sources`, `claims_check` (W17)
- [skill/profiles/docs.md](profiles/docs.md): `checked_against` (W18)

Version-2 briefs are in `skill/examples/v2/`, including version-2 versions of the two worked examples below. `explain` adds a Verification section for them.

## 3. Retry and verification policy

- **Retry.** A failed node goes back to the same builder with the verifier's fix, up to `policy.retry_budget_per_node` times. After that the failure goes to the owner. Never reassign silently.
- **Re-check.** The same verifier re-checks that fix narrowly (did the named defect go away?) while the node's `check` re-runs in full (did anything else break?).
- **Gates.** Independent verifiers sit at the gates: a `checkpoint` gate verifies the work so far; the `final` gate verifies the integrated result with an end-to-end check. The gate verifier must not be a node's builder (W04), and a final gate whose check only repeats node checks is blocked (W07).
- **Ping** (`policy.ping`) says when the orchestrator is woken: `every_node` after each node finishes (tight control, many wake-ups; use for risky or unfamiliar work); `failures_only` only when a node fails its check or exhausts retries (the default; use when checks are trustworthy); `phase_end` only when the phase is done or something fails terminally (use for cheap, well-understood work).
- **Per node or at the gates (version 2, `policy.verify`).** `per_node` (the default) gives every node its own verifier
  before it merges; `gates_only` merges a node on its passing `check` and clean boundary, and the gate verifier that
  covers it checks the work independently. Set it per work type, e.g. `"verify": {"code": "gates_only"}`, and override
  one node with its own `"verify"`. Choose `gates_only` for code whose `check` really exercises the node's criteria;
  keep `per_node` for frontend, research and docs (their profile checks are per node, W21) and for any node whose check
  is thin. Every `gates_only` node must be covered by a gate (W22). Measured on one mission: a verifier per node made
  the run about twice as slow as gate-only verification, with the same acceptance score.
- **Caps.** `caps.max_agents` >= `max_parallel`; `caps.max_retries_per_node` >= `retry_budget_per_node`. W13 counts retries into time: critical-path minutes x (1 + `retry_budget_per_node`) must not exceed `caps.max_minutes`. With a 90 minute critical path and 2 retries you need `max_minutes` of at least 270.
- **Effects.** Grant only what nodes use in `policy.allowed_effects`; anything beyond local read/write appears under "Needs your approval".

## 4. Worked example A: from scratch

Goal: a small tool that turns article titles into URL slugs. Brief: `skill/examples/scratch-brief.json`.

- Step 1: three criteria: slug rules sourced (c1), CLI works (c2), README shows real output (c3).
- Step 2: `d1` (hard, decided): slugs are ASCII lowercase letters, digits and single hyphens. `d2` (easy, open): licence. Left open on purpose; the owner sees it in `explain`.
- Step 3: phase `build`. Later phase `packaging` with `requires: ["src/slug.py", "d1"]`: a produced file and a decided decision, nothing else.
- Step 4: `n1` is a `research` node (the slug rules, from sources). Its check fails unless every bullet in `notes/research.md` ends with `[src: URL]`; its verifier opens each source. It needs `network`, granted in `policy.allowed_effects`. `n2` (library) depends on `n1` because it takes `notes/research.md` as input. `n3` (CLI) and `n4` (README) both depend on `n2` and can run in parallel; their `paths` are disjoint. `n5` is the integrator and depends on all four. `g1` is a checkpoint after the research; `g2` is the final gate.

First preflight of the draft (the final gate check was written `echo '...' | python3.11 src/cli.py | grep ...`):

```
$ python3.11 -m workbench preflight draft.json
BLOCK W03 gate g2: check cannot run or proves nothing: `echo 'Annual Report 2026' | python3.11 src/cli.py | grep -qx annual-report-2026` proves nothing
  fix: replace that line of g2.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
preflight: 1 block, 0 warn -> NOT READY
```

Fix: put the command first, so it is a real command: `python3.11 src/cli.py 'Annual Report 2026' | grep -qx annual-report-2026`. Then:

```
$ python3.11 -m workbench preflight skill/examples/scratch-brief.json
preflight: 0 block, 0 warn -> READY
```

The research node's check, from the brief:

```
python3.11 -c "import re,sys;t=open('notes/research.md').read();c=re.findall(r'^- ',t,re.M);s=re.findall(r'\[src: https?://\S+\]',t);sys.exit(0 if c and len(c)==len(s) else 1)"
```

Step 6, an excerpt of `python3.11 -m workbench explain skill/examples/scratch-brief.json`:

```
Waves
Wave 1: n1
Wave 2: n2
Wave 3: n3, n4
Wave 4: n5

Critical path
n1 -> n2 -> n3 -> n5 (75 min)

Gates
g1 [checkpoint] after n1 — verifier: checkpoint-reviewer — check: git status --short notes/
g2 [final] after n5 — verifier: final-reviewer — check: python3.11 src/cli.py 'Annual Report 2026' | grep -qx annual-report-2026

Open decisions
d2 (easy): Which licence?

Needs your approval
Effects:
  network — used by n1
Credentials:
  none
Tools:
  python3.11 — used by n1, n2, n3, n4, n5
```

The owner sees `n3` and `n4` run together, a 75 minute critical path, one open easy decision, and that `network` is requested by `n1` only.

## 5. Worked example B: an orc plan

Preflight an orc gate-2 plan to see what it lacks. Import the forex-calculator plan:

```
$ python3.11 -m workbench import-orc tests/fixtures/orc/forex-calculator.json -o skill/examples/orc-imported.json
imported 3 nodes from tests/fixtures/orc/forex-calculator.json -> skill/examples/orc-imported.json
```

```
$ python3.11 -m workbench preflight skill/examples/orc-imported.json
BLOCK W03 node n1: check cannot run or proves nothing: `test/calc.test.js contains assertions for each exact string in c1, c2, c3, c4, c5, c6, c7, c8 and the error cases in c9` starts with `test/calc.test.js`, which is not a command on PATH
  fix: replace that line of n1.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
BLOCK W03 node n2: check cannot run or proves nothing: `test/page.test.js asserts: no http:// or https:// in index.html; calc.js loaded by a non-module <script src>; all 28 pairs present in the picker` starts with `test/page.test.js`, which is not a command on PATH
  fix: replace that line of n2.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
BLOCK W03 node n2: check cannot run or proves nothing: `Main-session browser check (built-in browser, file:// URL): EUR/USD $10,000 1% SL 20 shows '0.50 lots'; EUR/GBP shows a 'GBP/USD' rate field and with 1.25, $50, SL 10 shows '0.40 lots'; blank balance shows a named error and no lot size; page text never contains NaN/Infinity/undefined; no network requests other than calc.js` starts with `Main-session`, which is not a command on PATH
  fix: replace that line of n2.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
BLOCK W03 node n2: check cannot run or proves nothing: `Main-session browser check at 375px width: document.documentElement.scrollWidth <= 375` starts with `Main-session`, which is not a command on PATH
  fix: replace that line of n2.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
BLOCK W03 node n3: check cannot run or proves nothing: `README.md exists and every number in its worked examples matches node -e output from calc.js computeView for the same inputs` starts with `README.md`, which is not a command on PATH
  fix: replace that line of n3.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
BLOCK W07 brief: has no integrator node
  fix: add a node with role "integrator" that depends on the builders and combines their outputs
BLOCK W07 brief: has no final gate
  fix: add a gate with kind "final", after the integrator, with its own check and an independent verifier
BLOCK W10 brief: the brief has no final gate, so nothing verifies the integrated result
  fix: add a gate with kind "final" whose after lists the integrator
BLOCK W13 policy: critical path 90 min x (1 + 2 retries) = 270 min > caps.max_minutes 90
  fix: set policy.caps.max_minutes to 270 or more, or cut estimate_minutes on the critical path (n1 -> n2 -> n3)
BLOCK W14 phase: no phase planned
  fix: write the phase name and objective: set phase.name and phase.objective
BLOCK W15 brief: no decisions recorded
  fix: list the hard-to-change decisions (data formats, interfaces, storage, permissions) in decisions, each with reversibility and status
preflight: 11 block, 0 warn -> NOT READY
```

The fixes, in the order made (the result is `skill/examples/orc-fixed.json`):

- W14, W15: set `phase` (name `build`, an objective) and record three decisions (calculation in a dependency-free classic script, crosses priced by a typed conversion rate, lots rounded down), `hard` ones `decided`.
- W03: orc's checks mix commands and prose. Keep the runnable lines (`cd ~/forex-calculator && node --test`); move the prose into the node's `verifier` (the browser-check wording for `n2`, the README-numbers comparison for `n3`). Tests that the node creates are listed in `outputs`.
- Mark `n2` `frontend` and `n3` `docs`; fill `outputs`/`inputs` so the graph is explicit (`n2` and `n3` take `calc.js`); add `tools: ["node"]`.
- W07, W10: add integrator `n4` depending on `n1`, `n2`, `n3`, and final gate `g1` after `n4`, with a check that is not just the node checks (`node --test` plus a scan of `index.html` for external URLs).
- W13: the 90 minute critical path with 2 retries needs 270 minutes; raise `caps.max_minutes` to 300 rather than shrinking the estimates.

```
$ python3.11 -m workbench preflight skill/examples/orc-fixed.json
preflight: 0 block, 0 warn -> READY
```

Note the imported brief's `work_type` is always `code`, `outputs` and `inputs` are empty, and `estimate_minutes` is `maxDurationMinutes` split evenly: review all three by hand.

## Checklist before showing the owner

- Every `hard` decision is `decided`; every criterion is on some node.
- Every `check` is a command; every `verifier` is someone other than the builder.
- Independent nodes have disjoint `paths`; consumers `depends_on` producers.
- An integrator and a final gate with an end-to-end check exist.
- `preflight` prints `-> READY`; the owner has read `explain`.
