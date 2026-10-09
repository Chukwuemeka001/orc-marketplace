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

## After the mission: continue it, or queue the next goal
A mission ends when the orchestrator writes `ops/FINAL.md` with a status. If you then want more of the same work (the
next phase, "carry on until it is done", a follow-up), say:
```
/orc continue <your request>
```
There is no new interview and no new gate: the understanding and rules you approved, your standing directives and the
plan carry into the next version, your request is recorded as the amendment, and the builders, checks, verifiers,
merges and the pane are back. The previous run's records move to `ops/history/`. Without this, a session that is asked
for more after the final report carries on as plain Claude Code, with none of orc's protections (one 7-hour run spent
its last 3 hours that way).

For a different goal, queue it: `/orc backlog add <request>`, then `/orc backlog next` when the mission is done; that
starts a new intake with its gates.

## What orc writes
- **In your repository, `ops/`:**
  - `ops/orc/`: the mission state, the understanding you approved, and the plan;
  - the orchestrator's records: `CONTRACTS.md`, `DECISIONS.md`, `work-orders/`, `FINAL.md`;
  - `integration/check.sh`, an end-to-end check of your criteria;
  - in auto mode, `brief.json`.
- **Beside your repository, `<repo>-wt/`:** one clone per builder (removed after merging) and verifier snapshots.
  Branches `wt/*` are kept.
- **In your home folder, `~/.claude/orc/` (or `$CLAUDE_CONFIG_DIR/orc/`):** an effort ledger (every agent's requests, tools, context and results) and
  saved reports.

A new session in a repository with a mission says so. `/orc resume` picks it up.

## Permissions
orc works in Claude Code's default permission mode. While a mission you approved is running, orc lets read-only tools
(Read, Grep, Glob) look inside its own folders without a dialog: `~/.claude/orc/` and the clones beside your
repository. Every other permission decision stays with Claude Code and you. Builders cannot edit or stage files
outside the paths the plan gave them, and orc audits the files their shell commands write.

## The orc computer (preview)
A mission can run inside a computer of its own on your machine:
- **Writes:** only to the repository and orc's clones beside it.
- **Network:** none, apart from hosts the plan names; local pages always work.
- **Browser:** a headless one with its own empty profile, kept apart from yours. Only the workers whose role you
  granted a browser at gate 2 get it.

How it works:
- **Walls:** Claude Code's built-in sandbox (OS-enforced: Seatbelt on macOS, bubblewrap on Linux). Shell commands
  inside it need no approval.
- **Browser:** Microsoft's Playwright MCP server, fetched with npx on first use (about 14 MB), driving the Chrome,
  Chrome Canary or Edge you have installed. With none installed, orc tells you how to add one.
- **Granted at gate 2:** gate 2 lists what the work will use. A browser granted to verifiers or builders gives those
  workers the `orc:verifier-web` / `orc:builder-web` types, and orc refuses them to anyone not granted.
- **Checked at launch:** orc opens a local page with the browser before anything is dispatched, so a problem shows
  up while you are there.

Turn it on with `/orc computer on`, or choose "Use the computer first" at gate 2. orc creates the repository if
needed and writes the sandbox settings into `.claude/settings.local.json` (kept out of git). The sandbox is set
when a session starts, so restart Claude Code in that folder and type `/orc resume`. `/orc computer` shows the
computer and whether this session is inside it; `/orc computer off` turns it off.

Limits:
- The repository must exist before a sandboxed session starts; `/orc computer on` takes care of that.
- The browser's site list is a guardrail, not a security boundary (Playwright's own words). The sandbox and the
  separate profile are the walls; virtual-machine isolation is not part of the preview.
- To keep the browser out entirely: `"browser": false` in the config.

## Commands
| command | what it does |
|---|---|
| `/orc begin <request>` | start the interview |
| `/orc approve`, `/orc correct <note>`, `/orc defer` | answer a gate |
| `/orc status` or `/orc` | the pane: agents, gates, the journal |
| `/orc resume [repo]` | pick a mission up in a new session |
| `/orc continue <request>` | continue a finished mission with your next request, under the approved rules, no new gates |
| `/orc directive <text>` | record a standing rule for this mission |
| `/orc backlog add <request>`, `/orc backlog next` | queue what comes next |
| `/orc policy retry=N parallel=N ping=failures_only` | change a running graph's rules (auto mode) |
| `/orc understanding` | print the approved understanding |
| `/orc computer [on\|off]` | show the mission's computer, or set it up for the next session |
| `/orc start <mission.md> [repo=…] [amendment=…]` | start from a written mission file instead of an interview |

## Configuration (optional)
`~/.claude/orc/config.json`:
```json
{ "model": null, "effort": null, "workersReadClaudeMd": true, "checkTimeoutMs": 300000, "gateDialog": true,
  "browser": { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.83"] } }
```
- `model` and `effort` apply to every orc agent; `null` keeps the session's. A model approved at gate 2 overrides
  `model`.
- `workersReadClaudeMd: false` gives builders and verifiers no CLAUDE.md.
- `workbenchDir` points auto mode at another copy of the Workbench.
- `browser`: the browser tool the orc computer uses (`false` turns it off); `browserOrigins` widens the local-only
  site list.
- `gateDialog: false` keeps gates in the pane and the commands only.

## Limits
- Keep the session open while a mission runs; orc acts through it.
- Mods are an early-access API of Claude Code and may change between releases.
- One mission per repository at a time.

## For the author's lab
`"lab": true` in the config turns on `/orc demo` (a bundled example scored by a hidden suite), `/orc study` and the
reload kickoff file. The bundled Workbench is a copy of its own repository (`workbench/VERSION` names the commit).
Run the smoke tests with `claude plugin test <plugin folder>`.
