# Workbench

The Workbench is a planning method (a skill) and a Python 3.11 standard-library CLI. You settle what to build, write a runner-neutral JSON work brief (goal, the phase planned deeply, later phases as `requires` lists, decisions with reversibility, a retry/verification/ping policy with caps, the node graph, gates), and `workbench preflight` checks it for 15 named planning mistakes before any agent runs. It never executes plan nodes or checks: it only reads briefs and orc `state.json` files and writes brief files. It can import an orc gate-2 plan so orc's plans can be preflighted too.

The planning method lives in [skill/SKILL.md](skill/SKILL.md) (read it first if you are an agent planning a brief). The checks are in [docs/checks.md](docs/checks.md).

## Install and run

No install, no dependencies. From the repository root:

    python3.11 -m workbench <command> [options]
    bin/workbench <command> [options]        # sh wrapper; sets PYTHONPATH and runs python3.11

Run `python3.11 -m workbench --help` for the command list. Tests: `python3.11 -m unittest discover -s tests`.

## Commands

### new PATH

Writes a version-2 skeleton brief (every key, empty strings and lists, default policy, no nodes). Refuses to overwrite.

### new PATH --type {code,frontend,research,docs}

As above, plus one node `n1` of that work type with every other node key empty and its profile fields present and empty (see "Version 2 briefs"). An unknown type is a usage error (exit 2).

    $ python3.11 -m workbench new b.json --type docs
    $ python3.11 -m workbench preflight b.json | grep W18
    BLOCK W18 node n1: docs node lists nothing it is checked against

    $ python3.11 -m workbench new b.json        # exit 0, prints nothing
    $ python3.11 -m workbench new b.json
    workbench: b.json: already exists; refusing to overwrite      # stderr, exit 2

### import-orc STATE -o OUTPUT [--version 2]

With `--version 2` it writes a starting version-2 brief instead: orc's nodes plus an integrator (every node's check together, and `ops/integration/check.sh`), a final gate that runs that script, gates-only verification for code, the plan's approved constraints recorded as decided hard decisions and its rule options as decided easy ones, and estimates spread so the critical path with retries fits the time cap. Real orc plans with runnable checks come out READY; prose checks still surface as W03.


Converts an orc `state.json` gate-2 plan (`understanding.plan.nodes`, `team.roles`, `executionPolicy`, `finalPicture.criteria`, `mission.statement`) into a brief. `-o/--output` is required.

    $ python3.11 -m workbench import-orc tests/fixtures/orc/forex-calculator.json -o skill/examples/orc-imported.json
    imported 3 nodes from tests/fixtures/orc/forex-calculator.json -> skill/examples/orc-imported.json

Mapping: every orc node becomes a `builder` node with `work_type` `code`; `resourceKeys` become `paths`; `dependsOn` becomes `depends_on`; `acceptanceChecks` are joined with newlines into `check`; the orc reviewer role whose `nodeIds` lists the node becomes `verifier`; `criterionIds` become `criteria`; `executionPolicy.allowedEffects` becomes every node's `effects` and `policy.allowed_effects`; `maxAgents` becomes `max_parallel` and `caps.max_agents`; `maxAttemptsPerNode - 1` becomes `retry_budget_per_node` and `caps.max_retries_per_node`; `maxDurationMinutes` becomes `caps.max_minutes` and is split evenly across nodes as `estimate_minutes`; `ping` is `failures_only`. Phase, later phases, decisions, gates, tools, credentials, inputs and outputs are left empty, so an imported brief fails preflight on purpose.

A state file with no plan fails:

    $ python3.11 -m workbench import-orc tests/fixtures/orc/tradelog.aborted.json -o out.json
    workbench: tests/fixtures/orc/tradelog.aborted.json: no orc gate-2 plan (understanding.plan.nodes missing)

### preflight BRIEF [--json] [--strict]

Runs W01-W15, and W16-W22 on version-2 briefs (see [docs/checks.md](docs/checks.md)) and prints findings. It never runs a check, never touches the network, and checks credentials by presence only (env var set / file exists), never reading or printing a value.

- `--json` prints one JSON object instead of text.
- `--strict` makes warnings count as not ready.

Human format: per finding `SEVERITY ID where: message` (severity `BLOCK` or `WARN ` padded to 5) and an indented `  fix:` line, then a summary line. The summary never pluralises. Output for a clean brief:

    $ python3.11 -m workbench preflight tests/fixtures/clean/example.json
    preflight: 0 block, 0 warn -> READY

A warn-only brief is READY, and NOT READY with `--strict`:

    $ python3.11 -m workbench preflight tests/fixtures/checks/w06.json
    WARN  W06 phase "release": lists 4 files for a phase that depends on unlearned work
      fix: replace its files and checks with a "requires" list
    preflight: 0 block, 1 warn -> READY
    $ python3.11 -m workbench preflight --strict tests/fixtures/checks/w06.json
    WARN  W06 phase "release": lists 4 files for a phase that depends on unlearned work
      fix: replace its files and checks with a "requires" list
    preflight: 0 block, 1 warn -> NOT READY

A skeleton fails:

    $ python3.11 -m workbench preflight b.json
    BLOCK W07 brief: has no integrator node
      fix: add a node with role "integrator" that depends on the builders and combines their outputs
    BLOCK W07 brief: has no final gate
      fix: add a gate with kind "final", after the integrator, with its own check and an independent verifier
    BLOCK W10 brief: the brief has no final gate, so nothing verifies the integrated result
      fix: add a gate with kind "final" whose after lists the integrator
    BLOCK W14 phase: no phase planned
      fix: write the phase name and objective: set phase.name and phase.objective
    BLOCK W15 brief: no decisions recorded
      fix: list the hard-to-change decisions (data formats, interfaces, storage, permissions) in decisions, each with reversibility and status
    preflight: 5 block, 0 warn -> NOT READY

JSON format (`ready` is false if any block, or any warn with `--strict`; stdout holds nothing else):

    $ python3.11 -m workbench preflight --json tests/fixtures/checks/w15.json
    {
      "ready": false,
      "findings": [
        {
          "id": "W15",
          "severity": "block",
          "where": "decision d2",
          "message": "is hard to reverse and still open",
          "fix": "decide it now: set decisions d2.choice and change its status to \"decided\""
        }
      ]
    }

Findings are ordered by check id, then in the order found.

### graph BRIEF

Prints Mermaid text: first line `flowchart TD`, one line per node (integrators drawn `[[ ]]`) and gate (`{{ }}`), then one edge per `depends_on` and per gate `after` entry.

    $ python3.11 -m workbench graph skill/examples/scratch-brief.json
    flowchart TD
        n1["n1: Find how URL slugs are normally built (c"]
        n2["n2: Write slugify(title) in src/slug.py impl"]
        n3["n3: Write the CLI in src/cli.py: slug for an"]
        n4["n4: Write README.md: purpose, rules (from th"]
        n5[["n5: Run the whole tool end to end and fix se"]]
        g1{{"g1: checkpoint"}}
        g2{{"g2: final"}}
        n1 --> n2
        n2 --> n3
        n2 --> n4
        n1 --> n5
        n2 --> n5
        n3 --> n5
        n4 --> n5
        n1 --> g1
        n5 --> g2

### explain BRIEF

Prints the plan for the owner to approve, with these headed sections in order: Goal; Phase being planned; Later phases (each with its requires); Waves (nodes that can run in parallel, in dependency order); Critical path (ids and total estimate_minutes); Gates; Open decisions (with reversibility); Needs your approval (effects other than local_read/local_write, every credential by name only, every tool). Empty sections print `(none)`.

    $ python3.11 -m workbench explain skill/examples/scratch-brief.json
    Goal
    A small Python tool that turns article titles into URL slugs, with a command-line front end and a README.

    Phase being planned
    build — Establish the slug rules from sources, then build the library, the CLI and the README and prove they work together.

    Later phases
    packaging — Publish the tool as an installable package.
      requires: src/slug.py
      requires: d1

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

For a version-2 brief, `explain` prints a `Verification` section between Waves and Critical path, one line per node in brief order. Version-1 briefs get no such section. From `skill/examples/v2/orc-fixed.json`:

    Verification
    n1 [code] runnable check — verified by r2: confirm test/calc.test.js asserts every exact string in c1-c9
    n2 [frontend] browser file://index.html, 5 steps — verified by r2: browser check on file://index.html: EUR/USD $10,000 1% SL 20 shows '0.50 lots'; EUR/GBP asks for 'GBP/USD'; blank balance shows a named error and no lot size; no NaN/Infinity/undefined; no horizontal scroll at 375px
    n3 [docs] checked against calc.js, 1 fact — verified by r2: reviewer compares every number in README worked examples against node -e computeView output
    n4 [code] runnable check — verified by r3

Line shapes: `[frontend] browser <target>, <n> steps`; `[research] <n> sources, claims: <claims_check cut to 60 characters with …>`; `[docs] checked against <files>, <n> facts` (entries starting `fact:` are facts; `nothing` when empty); `[code] runnable check`. A missing profile prints `browser check missing` or `no sources`; an empty verifier prints `verified by (nobody)`.

## Verification policy (version 2)

`policy.verify` is `per_node` (default), `gates_only`, or a map from work type to one of them
(`{"code": "gates_only"}`); a node's own `verify` overrides it. A `gates_only` node merges on its check and is verified
by the gate that covers it; `explain` shows that gate. W21 warns when frontend, research or docs work is set to gates
only; W22 blocks a gates-only node that no gate covers. Version-1 briefs are always per node.

## Exit codes

| code | meaning |
|---|---|
| 0 | success; for `preflight`, READY |
| 1 | `preflight` only: at least one block (or at least one warn with `--strict`) |
| 2 | bad input or usage: missing file, malformed JSON, brief failing the shape rules, aborted orc state, existing `new` target, argparse usage error |

Errors are one line on stderr, `workbench: <file>: <problem>`, never a traceback.

    $ python3.11 -m workbench preflight nope.json
    workbench: nope.json: file not found

## Brief format

A brief is one JSON object. Every key below is required; extra keys anywhere are allowed and ignored (a later phase may carry them, which W06 warns about). Strings may be empty, so a skeleton and an orc import are shape-valid. A wrong type, missing key, bad enum value or non-unique node/gate id exits 2 with a message such as `b.json: nodes[2].depends_on must be a list of strings`. Numbers are int or float; booleans are not numbers.

| key | type | meaning |
|---|---|---|
| `workbench_brief` | int, `1` or `2` | format version; `2` enables the profile keys below |
| `goal` | string | the owner's goal, in their words |
| `phase` | `{name: string, objective: string}` | the one phase planned deeply now |
| `later_phases` | `[{name: string, goal: string, requires: [string]}]` | phases not yet planned; `requires` lists what they need from this phase: node output paths or ids of decided decisions (W14) |
| `criteria` | `[{id: string, text: string}]` | what "done" means; every one must be covered by a node (W05) |
| `decisions` | `[{id, question, choice: string, reversibility: "hard"\|"easy", status: "decided"\|"open"}]` | choices that are costly to change (data formats, interfaces, storage, permissions); a hard one must not stay open (W15) |
| `policy` | object, below | retry, parallelism, ping and caps |
| `nodes` | `[node]`, below | units of work |
| `gates` | `[{id: string, kind: "checkpoint"\|"final", after: [string], check: string, verifier: string}]` | verification points; `after` names nodes or other gates; a final gate is independently verified |

`policy`:

| key | type | meaning |
|---|---|---|
| `retry_budget_per_node` | int | how many times a failed node is sent back to its builder |
| `max_parallel` | int | nodes running at once |
| `ping` | `"every_node"\|"failures_only"\|"phase_end"` | when the orchestrator is woken |
| `caps` | `{max_agents: int, max_retries_per_node: int, max_minutes: number}` | hard ceilings; W13 checks the policy against them |
| `allowed_effects` | optional `[effect]` | effects the run is granted; absent means `["local_read", "local_write"]`; W02 checks nodes against it |

`node`:

| key | type | meaning |
|---|---|---|
| `id` | string, unique | node id |
| `role` | `"builder"\|"integrator"` | an integrator combines builders' outputs |
| `work_type` | `"code"\|"frontend"\|"research"\|"docs"` | decides how the node is verified |
| `objective` | string | what the node achieves |
| `inputs` | `[string]` | files/artifacts it reads; one that another node outputs needs a dependency (W08) |
| `outputs` | `[string]` | files/artifacts it produces |
| `paths` | `[string]` | files and directories it may write; overlapping paths between independent nodes are W01 |
| `depends_on` | `[string]` | node ids that must finish first |
| `check` | string | runnable command(s), one per line; fails when the work is wrong (W03) |
| `verifier` | string | who judges the node, never its own builder (W04) |
| `effects` | `[effect]` | side effects the node has |
| `tools` | `[string]` | executables it needs on PATH (W11) |
| `credentials` | `[{name: string, kind: "env"\|"file"}]` | secrets it needs, by name only (W12) |
| `criteria` | `[string]` | criterion ids it delivers |
| `estimate_minutes` | number, >= 0 | used for waves and the critical path |

`effect` is one of `local_read local_write network publication messaging spend client_data`.

### Version 2 briefs

Set `workbench_brief` to `2` to add four optional node keys. In a version-1 brief they are ignored like any extra key, and version-1 briefs behave exactly as before (same output for every command). A present key of the wrong type is bad input (exit 2), e.g. `workbench: b.json: nodes[1].sources must be a list of strings`.

| key | type | profile | required by |
|---|---|---|---|
| `browser_check` | `{target: string, steps: [string]}` | frontend | W16 |
| `sources` | `[string]` | research | W17 |
| `claims_check` | string | research | W17 |
| `checked_against` | `[string]` | docs | W18 |

A profile key on a node of another work type is a warning (W19). Per-profile pages with worked examples: `skill/profiles/`; example briefs: `skill/examples/v2/`.

## Skill

`skill/SKILL.md` teaches an agent the method end to end, with two worked examples whose briefs are in `skill/examples/`: `scratch-brief.json` (from scratch, with a research node), and `orc-imported.json` / `orc-fixed.json` (an orc plan imported, failing, then fixed). It is not installed anywhere; point an agent at the file.

Profile pages (`skill/profiles/code.md`, `frontend.md`, `research.md`, `docs.md`) and version-2 example briefs (`skill/examples/v2/`) cover work-type verification profiles.
