# orc — orchestrate a project inside Claude Code

You describe what you want in your own words. orc interviews you, shows you its understanding and then a plan with
the rules it recommends, and starts nothing until you approve both. Then your Claude Code session orchestrates the
work:
- every builder works in its own clone of your repository and stays inside the files the plan gave it;
- each builder's check runs the moment it returns;
- independent verifiers check the result;
- a builder's work is merged only when it is accepted.

orc is a Claude Code mod: a plugin with code that runs inside Claude Code.

## Requirements
- Claude Code with mods: terminal v2.1.287 or later, or the Desktop app's Code tab from v2.1.286.
- git, and a repository (orc runs `git init` in an empty folder).
- Python 3.11 or later, only for auto mode, which runs the bundled Workbench planner.
- Tested on macOS.

## Install
```bash
claude plugin marketplace add <this repository>
```
```bash
claude plugin install orc@<marketplace name>
```
Then start a new session. If `/orc` is not recognised, start Claude Code once with network access: Claude Code
refreshes its switch for mods when it starts.

## Quickstart
In a folder for the work (an empty one is fine), type:
```
/orc begin A command-line tool that converts lengths between mm, cm, m, km, in, ft and mi. Python standard library only.
```
1. **Interview.** One question at a time, each with options and a recommended default. It ends by asking whether
   anything is missing.
2. **Gate 1: is this what you mean?** Your words next to its interpretation, with the criteria it will be judged on.
   Answer `/orc approve`, `/orc correct <what to change>` or `/orc defer` (or use the buttons in the `/orc` pane).
3. **Gate 2: approve this plan and these rules?** The steps, who checks them, which files each step may change,
   limits (agents, minutes, attempts), and a mode. Every rule shows its alternatives.
4. **The build.** The session dispatches builders, accepts or redoes their work, asks for verification, and writes
   `ops/FINAL.md`. Keep the session open: orc drives it by itself while it runs.

A three-file tool like the quickstart's takes about 5–10 minutes from approval to a verified result.

## Two modes (chosen at gate 2)
- **normal:** the session dispatches each builder and accepts each result.
- **auto:** the approved plan becomes a graph that runs by rule. Builders, checks, retries with the same builder,
  merges, the integration check and gates happen without the orchestrator. It is pinged only for a failure that has
  used its retries, a gate, or the end.

Measured on one mission with a hidden 15-test acceptance suite, the same model setup each time:

| mode | wall time | tokens | score |
|---|---|---|---|
| normal | 22 min | 17.0M | 15/15 |
| auto | 22 min | 6.9M | 15/15 |

## What orc writes
- **In your repository, `ops/`:**
  - `ops/orc/`: the mission state, the understanding you approved, and the plan;
  - the orchestrator's records: `CONTRACTS.md`, `DECISIONS.md`, `work-orders/`, `FINAL.md`;
  - `integration/check.sh`, an end-to-end check of your criteria;
  - in auto mode, `brief.json`.
- **Beside your repository, `<repo>-wt/`:** one clone per builder (removed after merging) and verifier snapshots.
  Branches `wt/*` are kept.
- **In your home folder, `~/.claude/orc/`:** an effort ledger (every agent's requests, tools, context and results) and
  saved reports.

A new session in a repository with a mission says so. `/orc resume` picks it up.

## Permissions
orc works in Claude Code's default permission mode. While a mission you approved is running, orc lets read-only tools
(Read, Grep, Glob) look inside its own folders without a dialog: `~/.claude/orc/` and the clones beside your
repository. Every other permission decision stays with Claude Code and you. Builders cannot edit or stage files
outside the paths the plan gave them, and orc audits the files their shell commands write.

## Commands
| command | what it does |
|---|---|
| `/orc begin <request>` | start the interview |
| `/orc approve`, `/orc correct <note>`, `/orc defer` | answer a gate |
| `/orc status` or `/orc` | the pane: agents, gates, the journal |
| `/orc resume [repo]` | pick a mission up in a new session |
| `/orc directive <text>` | record a standing rule for this mission |
| `/orc backlog add <request>`, `/orc backlog next` | queue what comes next |
| `/orc policy retry=N parallel=N ping=failures_only` | change a running graph's rules (auto mode) |
| `/orc understanding` | print the approved understanding |
| `/orc start <mission.md> [repo=…] [amendment=…]` | start from a written mission file instead of an interview |

## Configuration (optional)
`~/.claude/orc/config.json`:
```json
{ "model": null, "effort": null, "workersReadClaudeMd": true, "checkTimeoutMs": 300000 }
```
- `model` and `effort` apply to every orc agent; `null` keeps the session's. A model approved at gate 2 overrides
  `model`.
- `workersReadClaudeMd: false` gives builders and verifiers no CLAUDE.md.
- `workbenchDir` points auto mode at another copy of the Workbench.

## Limits
- Keep the session open while a mission runs; orc acts through it.
- Mods are an early-access API of Claude Code and may change between releases.
- One mission per repository at a time.

## For the author's lab
`"lab": true` in the config turns on `/orc demo` (a bundled example scored by a hidden suite), `/orc study` and the
reload kickoff file. The bundled Workbench is a copy of its own repository (`workbench/VERSION` names the commit).
Run the smoke tests with `claude plugin test <plugin folder>`.
