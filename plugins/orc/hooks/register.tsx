import { atom, read, update } from 'claude-code'
import { ownReadRoot, shellMask, sweepsStage, browserGranted, computerOf, sandboxSettingsFor, SAFE_BROWSER_TOOLS, UNSAFE_BROWSER_TOOLS, browserCallAllowed, continueRefusal, doneSection } from './policy'
import type { EngineInterface, Register } from 'claude-code'

import type { OrcActivity, OrcAgent, OrcBucket, OrcClass, OrcCompaction, OrcDemo, OrcEntry, OrcGraph, OrcGraphNode, OrcInboxItem, OrcMission, OrcTurn, OrcUnderstanding } from '../types'

// orc: an effort ledger for the orchestrator running in THIS session's main
// loop. Every main-loop tool call is timed, sized and classified; every model
// request is timed and its context measured; subagents are tracked by id.
// One JSONL row per turn lands in ~/.claude/orc/<sessionId>.jsonl.

const PANE = 'orc'
/** Packaging (Track B): these were lab constants; they are now set from <HOME>/.claude/orc/config.json at session.start.
 *  Keys: outDir, model (null = session default), effort (null = inherit), defaultRepo, checkTimeoutMs, livenessMinutes,
 *  scratchPrefixes. All optional. */
let HOME = ''
let OUT_DIR = '/tmp/orc'
let DEFAULT_REPO = ''
let CHECK_TIMEOUT_MS = 300000
let LIVENESS_MINUTES = 12
let SCRATCH_PREFIXES: string[] = ['/private/tmp/', '/tmp/', '/var/folders/', '/dev/null']
type OrcConfig = { lab?: boolean; workersReadClaudeMd?: boolean; gateDialog?: boolean; browser?: { command: string; args?: string[] } | null; browserOrigins?: string; outDir?: string; model?: string | null; effort?: 'low' | 'medium' | 'high' | null; defaultRepo?: string; checkTimeoutMs?: number; livenessMinutes?: number; scratchPrefixes?: string[]; labCompactAt?: number | null; labMaxCompactions?: number; workbenchDir?: string; labInjectVerifierDefect?: string | null }
async function loadConfig($: EngineInterface): Promise<OrcConfig> {
  let configDir = ''
  try {
    const h = await $.process.run(['/bin/sh', '-c', 'printf "%s\\n%s" "$HOME" "$CLAUDE_CONFIG_DIR"'], { timeoutMs: 5000 })
    const [home, cd] = h.stdout.split('\n')
    HOME = (home ?? '').trim() || HOME
    configDir = (cd ?? '').trim()
  } catch { /* keep default */ }
  // orc keeps its data beside Claude Code's own: ~/.claude/orc, or <CLAUDE_CONFIG_DIR>/orc when that is set.
  OUT_DIR = configDir ? `${configDir.replace(/\/+$/, '')}/orc` : HOME ? `${HOME}/.claude/orc` : OUT_DIR
  try { PLUGIN_ROOT = $.plugin.root } catch { /* older engine: keep '' */ }
  let cfg: OrcConfig = {}
  try {
    const raw = await $.fs.read(`${OUT_DIR}/config.json`)
    cfg = JSON.parse(raw) as OrcConfig
  } catch { /* no config: defaults */ }
  if (cfg.outDir) OUT_DIR = cfg.outDir.replace(/^~/, HOME)
  if (cfg.model !== undefined) LAB_MODEL = cfg.model
  if (cfg.effort !== undefined) LAB_EFFORT = cfg.effort
  LAB_COMPACT_AT = typeof cfg.labCompactAt === 'number' && cfg.labCompactAt > 0 ? cfg.labCompactAt : undefined
  LAB_MAX_COMPACTIONS = cfg.labMaxCompactions ?? 2
  WORKBENCH_DIR = typeof cfg.workbenchDir === 'string' ? cfg.workbenchDir : ''
  LAB = cfg.lab === true
  WORKERS_READ_CLAUDE_MD = cfg.workersReadClaudeMd !== false
  GATE_DIALOG = cfg.gateDialog !== false
  BROWSER = cfg.browser === null || (cfg.browser as unknown) === false ? null
    : cfg.browser && typeof cfg.browser.command === 'string' ? { command: cfg.browser.command.replace(/^~/, HOME), args: (cfg.browser.args ?? []).map(a => a.replace(/^~/, HOME)) }
    : { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', ...(await installedChromeArgs($))] }
  CONFIG_DIR = configDir || `${HOME}/.claude`
  BROWSER_ORIGINS = typeof cfg.browserOrigins === 'string' && cfg.browserOrigins ? cfg.browserOrigins : 'http://127.0.0.1:*;http://localhost:*'
  LAB_INJECT_DEFECT = typeof cfg.labInjectVerifierDefect === 'string' ? cfg.labInjectVerifierDefect : ''
  DEFAULT_REPO = (cfg.defaultRepo ?? HOME).replace(/^~/, HOME)
  if (cfg.checkTimeoutMs) CHECK_TIMEOUT_MS = cfg.checkTimeoutMs
  if (cfg.livenessMinutes) LIVENESS_MINUTES = cfg.livenessMinutes
  if (cfg.scratchPrefixes) SCRATCH_PREFIXES = cfg.scratchPrefixes
  try { await $.process.run(['mkdir', '-p', `${OUT_DIR}/ledger`, `${OUT_DIR}/wakes`], { timeoutMs: 5000 }) } catch { /* best effort */ }
  return cfg
}
const JOURNAL_CAP = 300
const TURNS_CAP = 400
const CLASSES: OrcClass[] = ['navigate', 'mechanic', 'verify', 'docs', 'delegate', 'human', 'external', 'other']
const ACTIVITIES: OrcActivity[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
const ACTIVITY_NAME: Record<OrcActivity, string> = {
  A: 'bookkeep', B: 'dispatch', C: 'supervise', D: 'intake', E: 'review', F: 'env/ops', G: 'recovery', H: 'owner', I: 'judgment', J: 'hands-on',
}

/** The folder this plugin was loaded from (plugin.json's); the bundled Workbench, examples and the edit lock use it. */
let PLUGIN_ROOT = ''
/** Lab switch (config "lab": true): the bundled demo, /orc study and the reload kickoff file. Off for everyone else. */
let LAB = false
/** Workers read the project's CLAUDE.md like any Claude Code agent (config "workersReadClaudeMd": false strips them,
 *  as the lab's measurements did). */
let WORKERS_READ_CLAUDE_MD = true
/** A pending gate is also asked in Claude Code's own question dialog (config "gateDialog": false keeps it to the pane and
 *  the commands). Owner, 2026-10-08: in the Desktop app the gate row "blended in so much" that he missed it. */
let GATE_DIALOG = true
/** The orc computer's browser (config "browser": {command, args}, e.g. Microsoft's Playwright MCP server): a headless
 *  browser with its own in-memory profile, local pages only by default (config "browserOrigins"; a guardrail, not a
 *  security boundary). Off unless configured. Only workers whose role gate 2 granted a browser get it. */
let BROWSER: { command: string; args: string[] } | null = null
let BROWSER_ORIGINS = 'http://127.0.0.1:*;http://localhost:*'
let CONFIG_DIR = ''
/** Which installed Chrome the default browser drives: Google Chrome, else Chrome Canary, else Edge; none means
 *  Playwright's own Chromium, which the launch check reports how to install. */
async function installedChromeArgs($: EngineInterface): Promise<string[]> {
  const mac = [['/Applications/Google Chrome.app', ['--browser', 'chrome']], ['/Applications/Google Chrome Canary.app', ['--executable-path', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary']], ['/Applications/Microsoft Edge.app', ['--browser', 'msedge']]] as const
  for (const [app, args] of mac) if (await $.fs.exists(app).catch(() => false)) return [...args]
  try {
    const r = await $.process.run(['/bin/sh', '-c', 'command -v google-chrome || command -v google-chrome-stable || command -v microsoft-edge'], { timeoutMs: 5000 })
    if (/google-chrome/.test(r.stdout)) return ['--browser', 'chrome']
    if (/microsoft-edge/.test(r.stdout)) return ['--browser', 'msedge']
  } catch { /* none */ }
  return []
}
const browserServer = () => BROWSER ? { command: BROWSER.command, args: [...BROWSER.args, '--headless', '--isolated', '--allowed-origins', BROWSER_ORIGINS, '--output-dir', `${OUT_DIR}/browser`] } : null
/** Is this session inside the computer? Read from the settings files (no API reports it); settings written after the
 *  session started take effect at the next start. */
async function sandboxStatus($: EngineInterface, repo: string): Promise<'on' | 'after-restart' | 'off'> {
  for (const f of [`${repo}/.claude/settings.local.json`, `${repo}/.claude/settings.json`, `${CONFIG_DIR}/settings.json`]) {
    try {
      const j = JSON.parse(await $.fs.read(f)) as { sandbox?: { enabled?: boolean } }
      if (j.sandbox?.enabled !== true) continue
      const st = await $.process.run(['/bin/sh', '-c', `stat -f %m "${f}" 2>/dev/null || stat -c %Y "${f}"`], { timeoutMs: 5000 })
      const mtime = Number(st.stdout.trim()) * 1000
      return mtime && SESSION_STARTED && mtime > SESSION_STARTED ? 'after-restart' : 'on'
    } catch { /* missing or not JSON */ }
  }
  return 'off'
}
let sandboxCache: { repo: string; at: number; status: 'on' | 'after-restart' | 'off' } | undefined
/** The pane redraws every few seconds: read the settings at most every 10 s. */
async function sandboxStatusCached($: EngineInterface, repo: string) {
  const now = await $.clock.now()
  if (sandboxCache && sandboxCache.repo === repo && now - sandboxCache.at < 10000) return sandboxCache.status
  const status = await sandboxStatus($, repo)
  sandboxCache = { repo, at: now, status }
  return status
}
const sandboxWords = (s: 'on' | 'after-restart' | 'off') => (s === 'on' ? 'this session is inside it' : s === 'after-restart' ? 'set; restart the session to step inside' : 'off for this session (/orc computer on)')
/** One line describing the computer, for cards, the dialog and UNDERSTANDING.md. */
function computerLine(m: OrcMission, status?: 'on' | 'after-restart' | 'off') {
  const c = computerOf(m)
  return `computer: browser ${c.browser.length ? `→ ${c.browser.map(r => `${r}s`).join(' and ')} (own profile, local pages only)` : 'none'} · network ${c.hosts.length ? c.hosts.join(', ') : 'off (local pages only)'} · writes: repo + clones${status ? ` · sandbox ${sandboxWords(status)}` : ''}`
}
/** /orc computer on|off: write (or remove) the sandbox settings for this repository, creating the repository first —
 *  a sandboxed session cannot create one, nor write to one made after it started. */
async function computerSwitch($: EngineInterface, turnOn: boolean): Promise<string> {
  const m = await read($, missionState)
  const repo = m?.repo ?? (await repoOf($, undefined))
  if (isHomeOrRoot(repo)) return `orc computer: ${repo} is your home folder; start a mission in a project folder first.`
  const path = `${repo}/.claude/settings.local.json`
  let j: Record<string, unknown> = {}
  try { j = JSON.parse(await $.fs.read(path)) as Record<string, unknown> } catch { j = {} }
  if (turnOn) {
    const inside = await $.process.run(['git', '-C', repo, 'rev-parse', '--git-dir'], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1 }))
    if (inside.exitCode !== 0) await $.process.run(['/bin/sh', '-c', `mkdir -p "${repo}" && git -C "${repo}" init -q`], { timeoutMs: 15000 })
    j.sandbox = m ? sandboxSettingsFor(m) : { enabled: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: [`${repo.replace(/\/+$/, '')}-wt`] }, network: { allowLocalBinding: true, allowedDomains: [] } }
  } else delete j.sandbox
  await $.process.run(['mkdir', '-p', `${repo}/.claude`], { timeoutMs: 5000 })
  await $.fs.write(path, JSON.stringify(j, null, 2) + '\n')
  try { await $.process.run(['/bin/sh', '-c', `cd "${repo}" && mkdir -p .git/info && (grep -qxF '.claude/settings.local.json' .git/info/exclude 2>/dev/null || echo '.claude/settings.local.json' >> .git/info/exclude)`], { timeoutMs: 5000 }) } catch { /* best effort */ }
  const at = await $.clock.now()
  if (m) { const next: OrcMission = { ...m, computer: { on: turnOn, at, settingsPath: path }, updatedAt: at }; await update($, missionState, () => next); await persistMission($, next) }
  await note($, { kind: 'note', agentId: 'owner', text: `orc computer ${turnOn ? 'ON' : 'OFF'}: ${path}` })
  return turnOn
    ? `orc computer: set for ${repo}.\n${m ? computerLine(m) : 'computer: no mission yet, so no browser and no network; writes: repo + clones'}\nIt takes effect when the session starts. Restart Claude Code in ${repo} (terminal: quit, then run claude there; Desktop: open a new session in that folder), then type /orc resume to continue inside the computer.\nOff again: /orc computer off. The settings live in ${path} (kept out of git).`
    : `orc computer: off for ${repo} from the next session (removed the sandbox block from ${path}). Restart, then /orc resume.`
}

/** The base role of a worker type: orc:builder-web works as orc:builder with a browser. */
const baseType = (t: string) => t.replace(/-web$/, '')
/** The gate already asked in the dialog, so each gate is asked once: a correction adds a decision, so the redrafted gate
 *  is a new one. */
let askedGate = ''
const gateKey = (m: OrcMission) => `${m.status}·${m.version}·${m.decisions.length}`
let LAB_EFFORT: 'low' | 'medium' | 'high' | null = null
let LAB_MODEL: string | null = null
const ORCHESTRATOR_PROMPT = `You are an orchestrator. You run a mission by reading it, deciding, delegating work to builder agents, verifying what comes back by running things yourself, and keeping a written record. You do not write product code yourself except to unblock integration when a builder has failed twice on the same piece.
Rules: keep an ops record under the repo's ops/ (work orders you issue, decisions, a status file, a final report). Give builders one scoped work order each with a clear done-means and the exact paths they may change; dispatch builders in the BACKGROUND (run_in_background true) and do not poll or wait for them: after dispatching, write your status file and end your turn; you are resumed automatically with each child's result, and you continue from your status file. While children run, author the next work orders and verification scripts. Spawn builders as subagent_type "orc:builder" and verifiers as "orc:verifier"; never other types. A builder's report is a claim, not a fact: verify by running tests and commands. After two failed rounds on one issue, change the shape of the work rather than retrying. Report deviations and gaps plainly in the final report; never claim verification you did not run.`
const LEDGER_PROMPT = ORCHESTRATOR_PROMPT + `
Ledger mode (this run): you keep NO status file and never re-read one. Each time you are woken, the message carries the resume ledger: what changed since your last wake (the child that returned, with its full report), what is still open and unmarked, and one line per child with its attempt state, when it returned, your verdict so far, and a pointer to its saved report. The ledger is a snapshot, not evidence of quality: verify each returned child by running things, then record your verdict with the tool mcp__orc__mark {taskId, verdict: accepted|rejected|redo, note}. An unmarked returned child stays flagged on every wake until you mark it. Keep DECISIONS.md and the work orders as before; the final report is still yours to write.`

const CHECKS_PROMPT = LEDGER_PROMPT + `
Registered checks (this run): every builder work order ends with ONE runnable check that stands for its done-means (exit 0 = pass). Put it in the builder's Agent prompt as two lines, exactly: "CHECK: <shell command>" and "CHECK_CWD: <absolute dir>". When that builder returns, the substrate runs the check and your wake carries its result: pass, fail or unavailable, with exit code, duration and the output tail. Do NOT re-run the check yourself before marking: mark on the wake's evidence. Run things yourself only when the check is unavailable or its output is inconclusive, and say so in the mark note. Independent verifiers for integrated milestones remain required.`

const AUTO_PROMPT = CHECKS_PROMPT + `
Substrate-dispatched verification (this run): you never dispatch verifiers. Your first line in DECISIONS.md must be "REPO: <absolute repo path>" and "MISSION: <absolute mission path>" and "AMENDMENT: <absolute amendment path>" (three lines). When you write <repo>/ops/CHECKPOINT-1.md the substrate dispatches an independent verifier against the mission's done-means and wakes you with its report. When the amendment is done and its checks pass, write <repo>/ops/READY-FINAL.md (one line is enough) and the substrate dispatches the final verifier against mission and amendment. After fixing anything it failed, append a line to READY-FINAL.md to request another final verification. Mark verifiers like any other child.`

const BOUND_PROMPT = AUTO_PROMPT + `
Write boundary (this run): every builder's Agent prompt carries one line "MAY_CHANGE: <space-separated repo-relative paths or directories>" taken from its work order. The substrate denies that builder Edit/Write and git staging outside those paths (parent directories of an allowed file may be created); shell writes are not denied but audited: when a builder returns, the wake carries a boundary audit (files changed in the repo outside its may_change, and shell commands that looked like writes outside it). A mechanical preflight runs inside every dispatch; its findings are appended to the builder's prompt, and a hard failure (check command does not parse, CHECK_CWD missing, MAY_CHANGE or CHECK line missing) is sent to you at once. Your own commits must name paths: "git add -A", "git add .", "git add --all" and "git commit -a" are denied for you.`

const FANIN_PROMPT = BOUND_PROMPT + `
Clones and fan-in (this run): every builder works in its own clone of the repository (a git worktree on its own branch, made by the substrate at dispatch; the builder is told its path). Builders COMMIT in their clone, staging paths by name. When you mark a builder accepted, the substrate merges its branch into the repository and the mark result says merged, nothing to merge, or CONFLICT with the files; on a conflict you decide (a fix packet on top of the repository, or reject). Before marking you may inspect a builder's branch with git log/diff against the repository. Your own commits touch ops/ only, by name.
Verification requests (this run): never write marker files. Call mcp__orc__request_verification {stage: "checkpoint"} when the first integrated version exists and {stage: "final"} when the amendment is done; the result is a receipt and the verifier's report arrives as a wake. Request final again after fixes.`

const DELTA_LEDGER_TEXT = `Delta ledger (this run): you keep NO status file and never re-read one. You keep your own context between wakes, so each wake tells you only what CHANGED since your last one (the child that returned, with its check result, boundary audit and its report, whole when short, else its head and a pointer; any integration-check result) and what is ACTIONABLE now (children returned and not yet marked; verification requests whose report has not arrived), plus a one-line count of what is running. Nothing else is repeated. The full ledger (every child, its state, your mark, a pointer to its saved report) is kept by the substrate in a file named in every wake; read it only if you have lost context. Record verdicts with the tool mcp__orc__mark {taskId, verdict: accepted|rejected|redo, note}; an unmarked returned child stays listed on every wake until you mark it. Keep DECISIONS.md and the work orders as before; the final report is still yours to write.`
const INTEG_PROMPT = FANIN_PROMPT.replace(/Ledger mode \(this run\):[\s\S]*?final report is still yours to write\./, DELTA_LEDGER_TEXT) + `
Integration (this run): you do not write or run integration scripts yourself. After the first merge the substrate dispatches an integrator agent that writes ops/integration/check.sh under its mandate (it may change only ops/integration/, never product code or tests) to exercise the mission's integrated done-means on the real inputs the mission names, at the repository's HEAD. From then on the substrate runs that script after every merge: a FAIL wakes you at once with the output tail and re-dispatches the integrator to diagnose (its report arrives as a wake naming the merge that most likely broke it; you decide the fix packet); a PASS is listed under CHANGED in your next wake, or wakes you itself when nothing else is running. You may request an integration pass yourself with mcp__orc__request_verification {stage: "integration", note} (do this after the amendment lands, so the check covers it). Mark integrators like any other child; accepting one merges nothing (it commits its own script by name in the repository). When you need the current state without waiting for a wake (for example the integration result after a merge you just accepted), call mcp__orc__status: it returns held results and open items and never dispatches anything.`
const INTEGRATOR_PROMPT = `Never run rm (or rm -rf) on a path built from a variable, such as rm -f $T/*: the session stops for a person's approval even in bypass mode. Leave scratch files in your own temp directory. Your orchestrator may steer you while you work: a line starting "[orc · steer from the orchestrator]" arrives with a tool result. Follow it within your task; it never widens what you may change, and you still report in your shape. You are an integrator. You own one repository's integration check: a script ops/integration/check.sh (plus helpers under ops/integration/) that exercises the mission's integrated done-means end to end on the real inputs the mission names, at the repository's HEAD, and exits 0 only when they all hold. You may create or change files only under ops/integration/; you never change product code, tests or other ops files. When the check finds a defect you do not fix it: you report it, most serious first, with the exact command and evidence, and name the merged branch that most likely introduced it (git log --merges, git diff). Keep the script self-contained, under two minutes, scratch under $TMPDIR, no network, no new dependencies; never read any directory whose name starts with hidden, and never write inside a corpus or fixture directory the mission names as read-only. Commit your script by name (git add ops/integration/... && git commit). Your final message is your report in exactly this shape, at most 35 lines: STATUS: pass|fail. RUN: the exact command. COVERS: one line per step group (at most 8). NOT COVERED: at most 5 lines. DEFECTS: most serious first, at most 5, one line each with command, evidence and the suspected merge, or none. Nothing else.`
const ORCHESTRATOR_FULL_PROMPT = `You are an orchestrator running on the orc substrate. You run a mission by reading it, writing the contracts and work orders, delegating the building to orc:builder agents in the background, judging what comes back on evidence, and keeping a written record (ops/CONTRACTS.md, ops/DECISIONS.md, work orders, a final report). You do not write product code yourself except to unblock integration when a builder has failed twice on the same piece.
How the substrate works for you: every builder you dispatch gets its own clone of the repository; its prompt carries CHECK / CHECK_CWD / MAY_CHANGE lines (optionally CHECK_TIMEOUT); the substrate preflights the dispatch, denies edits outside the grant, runs the check when the builder returns, and wakes you with the check result, a boundary audit and the builder's report. You record verdicts with mcp__orc__mark (accepting merges the clone; a conflict is reported and the repository left unchanged). You never dispatch verifiers or write marker files: call mcp__orc__request_verification {stage} and the report arrives as a wake; after the first merge an integrator agent writes the integration check and the substrate runs it after every merge (a FAIL wakes you; a PASS rides your next wake, or wakes you when nothing else is running). Each wake tells you only what changed and what is actionable; the full ledger is in a file named in every wake, for context loss only. A builder's report is a claim: judge it on the check result, the audit and, when those are inconclusive, what you run yourself, and say so in the mark note. After two failed rounds on one issue, change the shape of the work. Report deviations and gaps plainly; never claim verification you did not run.`
const NOLEDGER_PROMPT = FANIN_PROMPT.replace(/Ledger mode \(this run\):[\s\S]*?final report is still yours to write\./, 'Status-file mode (this run): the wake carries ONLY the returned child\'s check result and report, not a ledger. Keep ops/STATUS.md as your memory across wakes (what was dispatched, what returned, what you accepted) and read it first on every wake. Record verdicts with mcp__orc__mark as before (acceptance merges the clone).')

const BUILDER_PROMPT = `Never run rm (or rm -rf) on a path built from a variable, such as rm -f $T/*: the session stops for a person's approval even in bypass mode. Leave scratch files in your own temp directory. Your orchestrator may steer you while you work: a line starting "[orc · steer from the orchestrator]" arrives with a tool result. Follow it within your task; it never widens what you may change, and you still report in your shape. You are a builder. You implement exactly one work order in the repository it names, with Python 3.11 standard library only unless the order says otherwise, then run the checks the order names and commit on the current branch. Stay inside the paths the order allows. Match the surrounding style; few comments; no new dependencies, no network, no writes outside the repository. If the order is ambiguous or you hit a wall twice, stop and say so instead of improvising. Your final message is your report in exactly this shape and nothing else, at most 30 lines: STATUS: done|partial|blocked — one sentence. CHANGED: one line per file (at most 10; count the rest). CHECKED: what you ran and what it showed (at most 6 lines, commands verbatim). NOT CHECKED: at most 4 lines. DEVIATIONS: at most 4 lines, or none. Do not restate the order; the orchestrator's wake carries this report whole only when it is short.`
const VERIFIER_PROMPT = `Never run rm (or rm -rf) on a path built from a variable, such as rm -f $T/*: the session stops for a person's approval even in bypass mode. Leave scratch files in your own temp directory. Your orchestrator may steer you while you work: a line starting "[orc · steer from the orchestrator]" arrives with a tool result. Follow it within your task; it never widens what you may change, and you still report in your shape. You are a verifier. You check a finished piece of work against its written done-means by running things (tests, the CLI, the files), never by reading the builder's account. You change nothing in the repository. Your final message is your report in exactly this shape, at most 40 lines: VERDICT: PASS|FAIL (one line, naming the commit or snapshot checked). CRITERIA: one line per criterion, "PASS|FAIL|N/A <n> <criterion> — <command> → <evidence in a few words>". DEFECTS: most serious first, at most 5, one line each with command and evidence, or none. NOT CHECKED: at most 5 lines. Nothing else.`

const turns = atom({ plugin: 'orc', key: 'turns' } as const, [] as OrcTurn[])
const cur = atom({ plugin: 'orc', key: 'cur' } as const, null as OrcTurn | null)
const agents = atom({ plugin: 'orc', key: 'agents' } as const, {} as Record<string, OrcAgent>)
const journal = atom({ plugin: 'orc', key: 'journal' } as const, [] as OrcEntry[])
const isBandHidden = atom({ plugin: 'orc', key: 'isBandHidden' } as const, false)
const tick = atom({ plugin: 'orc', key: 'tick' } as const, 0)
const demo = atom({ plugin: 'orc', key: 'demo' } as const, null as OrcDemo | null)
const missionState = atom({ plugin: 'orc', key: 'mission' } as const, null as OrcMission | null)
/** The main-loop inbox (ops/DESIGN-MAIN-INBOX.md in the lab): everything the main session must know or do, in session state
 *  so it survives a hot reload; delivered through two doors, acknowledged by evidence, redelivered until then. */
const inboxState = atom({ plugin: 'orc', key: 'inbox' } as const, [] as OrcInboxItem[])

// ---- classification (heuristic; the table is the thing to tune) ------------

const NAV_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'NotebookRead', 'ReadNotifications'])
const MECH_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const DELEGATE_TOOLS = new Set(['Agent', 'SendMessage', 'TaskStop', 'Workflow', 'ListAgents', 'Monitor'])
const VERIFY_RE = /\b(pytest|unittest|tsc|npm (test|run (test|check|lint|build))|make (test|check)|check\.py|plugin validate|plugin test|cargo test|go test|jest|vitest|eslint|ruff|mypy|flake8|python3? -m (pytest|unittest))\b|(^|[;&|]\s*)(bash |sh |\.\/)[^\s;&|]*(integration|check|verify|test)[^\s;&|]*\.sh\b/
const MECH_RE = /(^|[;&|]\s*)(sed -i|mkdir|cp |mv |rm |touch |chmod|chown|ln |git (add|commit|push|checkout|switch|merge|rebase|stash|worktree|reset|cherry-pick|tag)|npm (install|i |ci)|pip install|brew install|cat\s*>|tee |patch |python3? - <<|>\s*\S)/
const NAV_RE = /(^|[;&|(]\s*|\$\(\s*|do\s+|then\s+)(cat|head|tail|less|sed -n|ls|find|grep|rg|wc|which|type|echo|jq|awk|cut|sort|uniq|tr|stat|file|du|df|pwd|env|printenv|date|git (log|status|diff|show|blame|branch|rev-parse|remote)|ps|lsof|curl -s|python3? -c|printf)\b/

const OPS_RE = /(\/ops\/|(^|\/)(HANDOFF|STATUS|DECISIONS|PLAN|MEMORY|CHECKPOINT[^\/\s]*|FINAL)\.md|\/memory\/|\/journal|\/reports?\/)/i
const SUPERVISE_RE = /^(\s*(ps|pgrep|tail -f|sleep|wait|jobs|lsof|cat [^;&|]*\.(log|out)|tail [^;&|]*\.(log|out)))\b/
const RECOVERY_RE = /\b(git (stash|reset|revert|reflog|fsck|checkout -- )|--resume|resume)\b/

/** Maps a classified call onto the study codebook's activity (A–J). Heuristic. */
function activityOf(tool: string, cls: OrcClass, args: Record<string, unknown>): OrcActivity {
  const path = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : ''
  const cmd = typeof args.command === 'string' ? args.command : ''
  if (cls === 'human') return 'H'
  if (tool === 'Agent' || tool === 'Workflow') return 'B'
  if (tool === 'ReadNotifications' || tool === 'Monitor' || tool === 'TaskStop' || tool === 'ListAgents' || tool === 'SendMessage') return 'C'
  if (tool === 'Bash' && SUPERVISE_RE.test(cmd)) return 'C'
  if (tool === 'Bash' && RECOVERY_RE.test(cmd)) return 'G'
  if (cls === 'docs') return OPS_RE.test(path) || OPS_RE.test(cmd) ? 'A' : 'H'
  if (cls === 'verify') return 'E'
  if (cls === 'navigate') return OPS_RE.test(path) || OPS_RE.test(cmd) ? 'A' : /\/reports?\//.test(path + cmd) ? 'E' : 'D'
  if (cls === 'mechanic') return tool === 'Bash' ? 'F' : 'J'
  if (cls === 'external') return 'D'
  return 'J'
}

function classify(tool: string, args: Record<string, unknown>): { cls: OrcClass; what: string } {
  const path = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : ''
  const isDoc = /\.(md|txt|rst)$/i.test(path) || /\/ops\//.test(path)
  if (tool === 'AskUserQuestion') return { cls: 'human', what: 'ask' }
  if (DELEGATE_TOOLS.has(tool)) return { cls: 'delegate', what: typeof args.description === 'string' ? args.description : tool }
  if (MECH_TOOLS.has(tool)) return { cls: isDoc ? 'docs' : 'mechanic', what: path || tool }
  if (NAV_TOOLS.has(tool)) return { cls: 'navigate', what: path || (typeof args.pattern === 'string' ? args.pattern : typeof args.query === 'string' ? args.query : typeof args.url === 'string' ? args.url : tool) }
  if (tool === 'Bash') {
    const full = typeof args.command === 'string' ? args.command.trim() : ''
    // Classify on the command itself, never on heredoc or quoted file bodies.
    const cmd = full.split(/<<-?\s*['"]?\w+['"]?/)[0] ?? full
    const what = full.replace(/\s+/g, ' ').slice(0, 60)
    if (VERIFY_RE.test(cmd)) return { cls: 'verify', what }
    if (MECH_RE.test(cmd) || /<</.test(full)) return { cls: /\.(md|txt)\b/.test(cmd) && /(cat\s*>|tee |>>?|<<)/.test(full) ? 'docs' : 'mechanic', what }
    if (NAV_RE.test(cmd)) return { cls: 'navigate', what }
    return { cls: 'other', what }
  }
  if (tool.startsWith('mcp__')) return { cls: 'external', what: tool.replace(/^mcp__/, '') }
  return { cls: 'other', what: tool }
}

// ---- small helpers ---------------------------------------------------------

const short = (s: string | undefined, n: number) =>
  s === undefined ? '' : s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…'
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`
}
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`)
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : '0%')
const bar = (part: number, whole: number, width: number) => {
  const n = whole > 0 ? Math.round((width * part) / whole) : 0
  return '█'.repeat(n) + '░'.repeat(Math.max(0, width - n))
}
const glyph = (status: string) =>
  status === 'running' ? '●' : status === 'completed' ? '✓' : status === 'pending' ? '○' : '✗'
const emptyBucket = (): OrcBucket => ({ count: 0, ms: 0, inBytes: 0, outBytes: 0, failed: 0 })
const sizeOf = (v: unknown) => {
  try {
    return JSON.stringify(v)?.length ?? 0
  } catch {
    return 0
  }
}
const argsOf = (e: Record<string, unknown>) => {
  const { tool: _t, tool_use_id: _i, consent: _c, agentId: _a, ...rest } = e
  return rest
}

function sumClasses(list: OrcTurn[]): Record<OrcClass, OrcBucket> {
  const out = Object.fromEntries(CLASSES.map(c => [c, emptyBucket()])) as Record<OrcClass, OrcBucket>
  for (const t of list)
    for (const c of CLASSES) {
      const b = t.classes[c]
      if (!b) continue
      out[c].count += b.count
      out[c].ms += b.ms
      out[c].inBytes += b.inBytes
      out[c].outBytes += b.outBytes
      out[c].failed += b.failed
    }
  return out
}
function sumActivities(list: OrcTurn[]): Record<OrcActivity, OrcBucket> {
  const out = Object.fromEntries(ACTIVITIES.map(a => [a, emptyBucket()])) as Record<OrcActivity, OrcBucket>
  for (const t of list)
    for (const a of ACTIVITIES) {
      const b = t.activities?.[a]
      if (!b) continue
      out[a].count += b.count
      out[a].ms += b.ms
      out[a].inBytes += b.inBytes
      out[a].outBytes += b.outBytes
      out[a].failed += b.failed
    }
  return out
}
const toolMs = (t: OrcTurn) => CLASSES.reduce((n, c) => n + (t.classes[c]?.ms ?? 0), 0)
const toolCount = (t: OrcTurn) => CLASSES.reduce((n, c) => n + (t.classes[c]?.count ?? 0), 0)
const inBytes = (t: OrcTurn) => CLASSES.reduce((n, c) => n + (t.classes[c]?.inBytes ?? 0), 0)

async function note($: EngineInterface, entry: Omit<OrcEntry, 't'>) {
  const t = await $.clock.now()
  await update($, journal, list => [...(list ?? []), { t, ...entry }].slice(-JOURNAL_CAP))
}

function patchAgent($: EngineInterface, id: string, fn: (a: OrcAgent) => OrcAgent) {
  return update($, agents, map => {
    const found = map?.[id]
    return found ? { ...map, [id]: fn(found) } : (map ?? {})
  })
}

function patchCur($: EngineInterface, fn: (t: OrcTurn) => OrcTurn) {
  return update($, cur, t => (t ? fn(t) : t))
}

async function ledgerPath($: EngineInterface) {
  const id = await $.session.id()
  return `${OUT_DIR}/${id}.jsonl`
}

async function writeAgents($: EngineInterface) {
  const map = (await read($, agents)) ?? {}
  const id = await $.session.id()
  const rows = Object.values(map).sort((a, b) => a.startedAt - b.startedAt)
  const text =
    rows
      .map(a =>
        JSON.stringify({
          ...a,
          tools: (a.tools ?? []).map(x => ({ ...x, class: x.cls, activity: x.act, args_bytes: x.outBytes, result_bytes: x.inBytes })),
        }),
      )
      .join('\n') + (rows.length ? '\n' : '')
  await $.fs.write(`${OUT_DIR}/${id}.agents.jsonl`, text)
}

async function writeLedger($: EngineInterface) {
  await writeAgents($)
  const list = (await read($, turns)) ?? []
  const path = await ledgerPath($)
  const text =
    list
      .map(t =>
        JSON.stringify({
          ...t,
          tools: t.tools.slice(0, 200).map(x => ({ ...x, class: x.cls, activity: x.act, args_bytes: x.outBytes, result_bytes: x.inBytes })),
        }),
      )
      .join('\n') + (list.length ? '\n' : '')
  await $.fs.write(path, text)
  return path
}

// A kickoff file: when it holds text, submit it as a prompt once and blank it.

/** Switches an orchestrator type runs with. `orc:orchestrator` is the packaged default: everything on. The historical
 *  lab types stay as aliases so old ledgers and resumable agents keep working; they are no longer registered. */
type Switch = 'ledger' | 'checks' | 'bound' | 'fanin' | 'integ' | 'noledger'
const FULL: Switch[] = ['ledger', 'checks', 'bound', 'fanin', 'integ']
const TYPE_SWITCHES: Record<string, Switch[]> = {
  'orc:orchestrator': FULL,
  'orc:orchestrator-integ': FULL,
  'orc:orchestrator-fanin': ['ledger', 'checks', 'bound', 'fanin'],
  'orc:orchestrator-fanin-noledger': ['ledger', 'checks', 'bound', 'fanin', 'noledger'],
  'orc:orchestrator-bound': ['ledger', 'checks', 'bound'],
  'orc:orchestrator-auto': ['ledger', 'checks'],
  'orc:orchestrator-checks': ['ledger', 'checks'],
  'orc:orchestrator-ledger': ['ledger'],
}
const hasSwitch = (t: string, sw: Switch) => (TYPE_SWITCHES[t] ?? []).includes(sw)
const isLedgerType = (t: string) => hasSwitch(t, 'ledger')
const isChecksType = (t: string) => hasSwitch(t, 'checks')
const isIntegType = (t: string) => hasSwitch(t, 'integ')
/** children that carry a registered check and a write boundary of their own */
const isCheckedChild = (t: string) => baseType(t) === 'orc:builder' || t === 'orc:integrator'
/** removal run: the wake carries only the returned child's result; the orchestrator keeps its own status file */
const isNoLedger = (t: string) => hasSwitch(t, 'noledger')
/** marker-file polling applies only to the older auto/bound types; fanin uses the request_verification action */
const isBoundType = (t: string) => hasSwitch(t, 'bound')
const isFaninType = (t: string) => hasSwitch(t, 'fanin')
/** Packet 2: the main session itself as orchestrator. Its row in the agents map has this id; it is never in
 *  $.agent.list(), so anything that would be sent to it goes to the main loop as a prompt instead. */
const MAIN_ORCH = 'main'
/** Edit lock (owner rule 2026-10-06): while a mission runs, the main session may not write into the plugin's own folders,
 *  because a save hot-reloads the plugin mid-mission and drops in-flight state. The owner overrides with /orc allow-edit. */
let SESSION_ID = ''
let SESSION_STARTED = 0
const modRoots = () => [...new Set([PLUGIN_ROOT, ...(LAB ? [SESSION_ID ? `${HOME}/.claude/dev-mods/${SESSION_ID}/orc` : '', `${HOME}/.claude/skills/orc`, `${HOME}/orc-lab/dist/orc`] : [])].filter(Boolean))]
const WRITE_VERB = /(^|[\s;&|])(>>?|sed\s+-i|cp\s|mv\s|rsync\s|rm\s|tee\s|install\s|touch\s|ln\s|git\s+checkout|open\([^)]*['"]w|\.write\()/
function modEditViolation(tool: string, args: Record<string, unknown>): string | undefined {
  const roots = modRoots()
  if (!roots.length) return undefined
  const hit = (p: string) => roots.find(r => p === r || p.startsWith(`${r}/`))
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const fp = String(args.file_path ?? args.notebook_path ?? '')
    const r = hit(fp.replace(/^~/, HOME))
    return r ? `${tool} → ${fp} (plugin folder ${r})` : undefined
  }
  if (tool === 'Bash') {
    const cmd = String(args.command ?? '').replace(/~\//g, `${HOME}/`)
    const r = roots.find(x => cmd.includes(x))
    if (r && WRITE_VERB.test(cmd)) return `Bash writes under plugin folder ${r}`
  }
  return undefined
}
const mainOrch = (map: Record<string, OrcAgent>): OrcAgent | undefined => {
  const r = map[MAIN_ORCH]
  return r && (r.status === 'running' || r.status === 'pending') ? r : undefined
}
/** Children of this orchestrator RUN: the main row is recreated per mission, so children of an earlier mission (same
 *  parentId) are excluded by their start time. */
const kidsOf = (map: Record<string, OrcAgent>, orch: OrcAgent): OrcAgent[] =>
  Object.values(map).filter(a => a.parentId === orch.id && (orch.id !== MAIN_ORCH || a.startedAt >= orch.startedAt - 1000))
/** Deliver text to an orchestrator: the main session gets a prompt; a subagent gets a session message. */
async function notifyOrch($: EngineInterface, orchId: string, text: string) {
  if (orchId === MAIN_ORCH) { await inboxPush($, { kind: 'wake', text }); return }
  await $.session.send({ to: orchId, text })
}

const VERIFIER_BRIEF = (stage: 'checkpoint' | 'final', repo: string, mission: string, amendment: string, finalPath: string, snap?: { path: string; sha: string }, scopeNote?: string) =>
  `You are an independent verifier dispatched by the substrate at the ${stage} of the mission in ${snap && mission.startsWith(`${repo}/`) ? `${snap.path}/${mission.slice(repo.length + 1)}` : mission}. Repository: ${repo}. ` +
  (snap
    ? `Check the SNAPSHOT at ${snap.path}: a detached copy of the repository at commit ${snap.sha.slice(0, 12)}, cut when verification was requested. Run everything there (cd into it); never read, run or write in ${repo} itself, which other agents may change while you work. `
    : `No snapshot could be cut, so check ${repo} as it is now; if git status shows files changing under you, say so in the report. `) +
  (stage === 'checkpoint'
    ? `A checkpoint checks work done so far, not the finished mission. Its scope is the newest ops/CHECKPOINT-*.md in ${snap ? 'the snapshot' : 'the repository'}${scopeNote ? `, and the orchestrator's note: "${scopeNote.replace(/"/g, "'")}"` : ''}. Check every mission "Done means" item that scope names by running things (tests, CLI, real inputs named in the mission, the golden check). An item outside the scope, work the scope says is still being built, and the orchestrator's final report are NOT IN SCOPE: list them under NOT CHECKED, never FAIL. With no scope file and no note, check every "Done means" item except the final report. `
    : `Check every mission "Done means" item${amendment && amendment !== '(none)' ? ` AND every item of the amendment in ${amendment}` : ''}, by running things. The orchestrator's final report (${snap && finalPath.startsWith(`${repo}/`) ? `${snap.path}/${finalPath.slice(repo.length + 1)}` : finalPath}) is committed as a draft whose STATUS line reads PENDING until a final verification passes: check that it has the sections the mission asks for and that its claims match the repository; a PENDING status is expected, not a failure. `) +
  `Rules: read-only, change nothing in the repository; write scratch files only under your own temp directory; never read any directory under ${repo.replace(/\/[^/]+\/?$/, '')} whose name starts with hidden, and never write inside a corpus or fixture directory the mission names as read-only; the machine may be loaded, so skip inputs over 100 MB and run any performance test once, reporting the measured time together with the 1-minute load average and core count (sysctl -n vm.loadavg / hw.ncpu, or /proc/loadavg / nproc); a timing miss while the load exceeds the core count is "UNMEASURED under load", not FAIL; finish within about 8 minutes. Report in exactly this shape, at most 40 lines: VERDICT: PASS|FAIL (one line, naming the commit checked). CRITERIA: one line per criterion, "PASS|FAIL|N/A <n> <criterion> — <command> → <evidence in a few words>". DEFECTS: most serious first, at most 5, one line each with command and evidence, or none. NOT CHECKED: at most 5 lines. Nothing else.`

/** Switch 4: a per-builder clone, a git worktree on its own branch cut from the repository's HEAD. */
/** How an integrator writes ops/integration/check.sh (the substrate's integrator and a graph integrator node share it). */
const CHECK_SCRIPT_GUIDE = (what: string, amendment: string | undefined) =>
  `Write or update ops/integration/check.sh so that "bash ops/integration/check.sh" run from the repository root exits 0 only when ${what} that can be checked mechanically holds at HEAD: translate each such item into one step that exercises the real thing (the test suite; CLI commands and their documented exit codes; real inputs or real processes the mission names, started and stopped by the script; concurrency, crash or recovery scenarios the mission specifies; any stated performance bound, run once)${amendment ? `, and every item of the amendment in ${amendment}` : ''}. Print one PASS/FAIL line per step and a final INTEGRATION: PASS|FAIL line. A step whose outcome depends on time passing (lease expiry, deadlines, restarts within a lease) must drive the system's own injected clock where the mission provides one (a clock file, a fake clock) rather than sleep against real-time leases, and timing bounds must be measured once with generous margins: a check that fails because the machine is loaded is noise, not a finding. A step that enforces a wall-clock bound must read the 1-minute load average and the core count first (sysctl -n vm.loadavg and hw.ncpu on macOS; /proc/loadavg and nproc on Linux), print both on its line, and when the load exceeds the core count print "SKIP <step> timing unmeasured (load X > Y cores)" instead of PASS or FAIL: a skipped timing step never fails the run, and the orchestrator re-times it on a quiet machine. The script must be self-contained, finish in under two minutes, write scratch only under $TMPDIR, and never read any directory whose name starts with hidden, and never write inside a corpus or fixture directory the mission names as read-only. If the script already exists, improve it rather than rewriting it, and keep what it covered.`
const INTEGRATOR_BRIEF = (reason: string, repo: string, mission: string, amendment: string | undefined) =>
  `You are the integrator dispatched by the substrate for the mission in ${mission}. Repository: ${repo} (work in it directly at HEAD; make no clone). Reason for this dispatch: ${reason}.
MAY_CHANGE: ops/integration
CHECK: bash ops/integration/check.sh
CHECK_CWD: ${repo}
Read the mission's "Done means" first. ${CHECK_SCRIPT_GUIDE('every mission "Done means" item', amendment)} Then run it once. If it fails, do not fix product code: find which merged branch most likely introduced the defect (git log --merges --first-parent, git diff) and say so. Commit your files by name. Report in exactly this shape, at most 35 lines: STATUS: pass|fail. RUN: the exact command. COVERS: one line per step group (at most 8). NOT COVERED: at most 5 lines. DEFECTS: most serious first, at most 5, one line each with command, evidence and the suspected merge, or none. Nothing else.`

async function runScript($: EngineInterface, command: string, cwd: string): Promise<{ status: 'pass' | 'fail' | 'unavailable'; exitCode: number | null; ms: number; tail: string }> {
  const t0 = await $.clock.now()
  try {
    const ran = await $.process.run(['/bin/sh', '-c', command], { cwd, timeoutMs: 300000 })
    const out = `${ran.stdout}\n${ran.stderr}`.trim()
    return { status: ran.exitCode === 0 ? 'pass' : 'fail', exitCode: ran.exitCode, ms: (await $.clock.now()) - t0, tail: out.split('\n').slice(-30).join('\n').slice(-3000) }
  } catch (err) {
    return { status: 'unavailable', exitCode: null, ms: (await $.clock.now()) - t0, tail: short(String(err), 300) }
  }
}

/** Mission and amendment paths from the repository's DECISIONS.md header (the amendment only once a checkpoint was requested). */
async function missionOf($: EngineInterface, repo: string, orch: OrcAgent): Promise<{ mission: string; amendment?: string }> {
  let mission = '', amendment = ''
  try {
    const text = await $.fs.read(`${repo}/ops/DECISIONS.md`)
    mission = /^MISSION:\s*(\S+)/m.exec(text)?.[1] ?? ''
    amendment = /^AMENDMENT:\s*(\S+)/m.exec(text)?.[1] ?? ''
  } catch {
    /* fall through */
  }
  const pastCheckpoint = (orch.verifyRequests ?? []).some(v => v.stage === 'checkpoint' || v.stage === 'final')
  return { mission: mission || '(mission file unknown: read ops/ in the repository)', amendment: pastCheckpoint && amendment ? amendment : undefined }
}

/** Dispatch the integrator for an orchestrator (through the main loop), at most one at a time. */
async function dispatchIntegrator($: EngineInterface, map: Record<string, OrcAgent>, orch: OrcAgent, repo: string, reason: string, direct = false): Promise<boolean> {
  const busy = Object.values(map).some(a => a.parentId === orch.id && a.type === 'orc:integrator' && (a.status === 'running' || a.status === 'pending'))
    || ((await read($, inboxState)) ?? []).some(i => !i.ackedAt && i.spawn?.type === 'orc:integrator' && i.spawn.description.includes(`[for ${orch.id.slice(0, 7)}]`))
  if (busy) return false
  const now = await $.clock.now()
  const last = orch.integration?.dispatches?.slice(-1)[0]
  if (last && now - last.at < 90000) return false
  const { mission, amendment } = await missionOf($, repo, orch)
  const description = `auto integrator: ${short(reason, 36)} [for ${orch.id.slice(0, 7)}]`
  if (direct) {
    // From an event hook (auto mode): the spawn stays observed, and the orchestrator is not woken to do it.
    try {
      const r = await $.agent.spawn({ subagentType: 'orc:integrator', description, prompt: INTEGRATOR_BRIEF(reason, repo, mission, amendment) })
      const iid = (r as { agentId?: string }).agentId
      if (!iid) return false
      await patchGraph($, gg => ({ ...gg, runnerIntegrators: [...(gg.runnerIntegrators ?? []), iid] }))
    } catch { return false }
  } else {
    await relayViaMain($, 'spawn-integrator', { description, prompt: INTEGRATOR_BRIEF(reason, repo, mission, amendment) })
  }
  // Keep a pending post-merge run (`due`): a request made right after a merge must not swallow that run.
  await patchAgent($, orch.id, a => ({ ...a, integration: { ...(a.integration ?? {}), repo, runs: a.integration?.runs ?? [], dispatches: [...(a.integration?.dispatches ?? []), { at: now, reason }] } }))
  await note($, { kind: 'spawn', agentId: orch.id, text: `integrator dispatched: ${short(reason, 50)}` })
  return true
}

/** The orchestrator's working rules for a mission (the lab's protocol, generic form). */
function orchestratorPrompt(mission: string, repo: string, amendment: string | undefined, finalPath: string) {
  const forbidden = amendment ? `Never read ${amendment} before the checkpoint.` : ''
  return `You are the orchestrator for the mission in ${mission}. Read it first, whole.

Working rules
- Repository: ${repo} (orc has already run git init if it did not exist; commit the scaffold, ops/CONTRACTS.md and the work orders BEFORE dispatching any builder, because each builder's clone is cut from the repository's HEAD). Write interfaces between builders into ${repo}/ops/CONTRACTS.md before dispatch; every work order points at it.
- Delegate the building. Spawn builders with the Agent tool as subagent_type "orc:builder" (or "orc:builder-web" for a step the approved plan gives a browser; never other types; never set a model). Verifiers and the integrator are dispatched by the substrate, never by you.
- DISPATCH IN THE BACKGROUND: every Agent call uses run_in_background true. Never poll, sleep or wait for a child. After dispatching, END YOUR TURN. You are woken each time a child finishes, with the registered check's result and the child's report. On wake, act on that evidence (mark it), then dispatch the next work or finish. While children run, write the next work orders. At most 3 children at a time.
- Each builder gets one written work order under ${repo}/ops/work-orders/<id>.md: objective, done_means (runnable), may_change (paths), must_not, what to report (the builder's fixed shape: STATUS / CHANGED / CHECKED / NOT CHECKED / DEVIATIONS). Point the builder at the file.
- REGISTERED CHECKS: each builder's Agent prompt carries exactly "CHECK: <shell command>" and "CHECK_CWD: ${repo}" (optionally "CHECK_TIMEOUT: <seconds>"). The substrate runs the check on return and your wake carries pass/fail/unavailable with the output tail. Do not re-run it yourself before marking; run things only when the result is unavailable or inconclusive, and say so in the mark note.
- WRITE BOUNDARY AND CLONES: each builder's prompt carries exactly "MAY_CHANGE: <space-separated repo-relative paths>". The substrate cuts the builder its own clone (git worktree) from HEAD; it edits, tests and commits there, staging by name. Edit/Write and git staging outside MAY_CHANGE are denied; shell writes are audited. When you mark a builder accepted, its branch is merged (MERGED / NOTHING TO MERGE / CONFLICT with the repository left unchanged; on a conflict, a fix packet cut from HEAD or reject). Your own commits touch ops/ only, by name; sweeping adds and commit -a are denied for you.
- DISPATCH PREFLIGHT: the substrate checks each dispatch mechanically and appends its findings to the builder's prompt; a hard finding is sent to you at once.
- VERIFICATION: the first four lines of ${repo}/ops/DECISIONS.md must be exactly "REPO: ${repo}", "MISSION: ${mission}", "AMENDMENT: ${amendment ?? '(none)'}", "FINAL: ${finalPath}". Verifiers check a snapshot of the repository's HEAD, so COMMIT everything you want verified before you request it. When the first integrated version exists, write ${repo}/ops/CHECKPOINT-1.md naming what the checkpoint covers and what is still being built (the verifier checks only what it covers), commit it, and call mcp__orc__request_verification {stage: "checkpoint"}. When the amendment (if any) is done and its checks pass, write ${finalPath} as a draft whose status line reads "STATUS: PENDING final verification", commit it, then call {stage: "final"}; after fixing anything a final verifier failed, update the draft, commit, and call {stage: "final"} again. Receipts are not verdicts; reports arrive as wakes. Mark verifiers like any other child. Do not change the status line from PENDING until a final verification has passed or you have recorded why you are stopping.
- DELTA LEDGER: you keep no status file. Each wake tells you what changed and what is actionable, and separates what the substrate PROVED (the registered check it ran, the boundary audit, the merge) from what the child CLAIMED: never re-run the registered check; spot-check only claims the check does not cover, and say in the mark note what you ran. The full ledger is in a file named in every wake, for context loss only. Record verdicts with mcp__orc__mark {taskId, verdict: accepted|rejected|redo, note}. Keep ${repo}/ops/DECISIONS.md (numbered, append-only). Call mcp__orc__status when you need the current state without a wake.
- INTEGRATION: after your first accepted merge the substrate dispatches an integrator that writes ${repo}/ops/integration/check.sh; the substrate runs it after every merge; a FAIL wakes you; a PASS rides your next wake, or wakes you when nothing else is running. Request an integration pass with mcp__orc__request_verification {stage: "integration"} after the amendment lands.
- ${forbidden ? `${forbidden} ` : ''}Never read any directory whose name starts with "hidden" (an owner's acceptance suite may live there). Never write outside ${repo} except the final report and scratch under your own temp directory.
- Stop rule: two failed rounds on the same issue means change the shape of the work, not a third retry.

Finish by writing ${finalPath}: what was built; what was verified and the exact commands; deviations; known gaps; a per-builder account (asked, came back, redone); how many times you were resumed. Your last message is that path and the status line from it.`
}

/** Start a mission: write the orchestrator prompt and have the main loop spawn the orchestrator (so its hooks are observed). */
async function startMission($: EngineInterface, args: { mission: string; repo?: string; amendment?: string; final?: string; fresh?: boolean; archive?: boolean; mode?: 'main' | 'subagent'; compactAt?: number; maxAgents?: number; auto?: boolean }): Promise<string> {
  const mission = args.mission.replace(/^~/, HOME)
  if (!(await $.fs.exists(mission))) return `orc start: mission file not found: ${mission}`
  let repo = (args.repo ?? '').replace(/^~/, HOME)
  if (!repo) {
    const text = await $.fs.read(mission)
    const m = /Repository:\s*`?([^\s`]+)`?/.exec(text)
    repo = (m ? m[1]!.replace(/\/$/, '') : `${DEFAULT_REPO}/${mission.replace(/.*\//, '').replace(/\.md$/i, '')}`).replace(/^~/, HOME)
  }
  const amendment = args.amendment ? args.amendment.replace(/^~/, HOME) : undefined
  const finalPath = (args.final ?? `${repo}/ops/FINAL.md`).replace(/^~/, HOME)
  const pkg = await read($, missionState)
  if (pkg && pkg.repo === repo && !['approved', 'running', 'done'].includes(pkg.status)) return `orc start: REFUSED — ${repo} has an owner understanding in state "${pkg.status}"; work starts only after the owner approves the understanding AND the work permission (/orc pane, or /orc approve). Nothing was started.`
  let archived = ''
  if (!args.fresh && ((await $.fs.exists(finalPath)) || (await $.fs.exists(`${repo}/ops/DECISIONS.md`)))) {
    if (!args.archive) return `orc start: REFUSED — ${repo} already holds a run (${(await $.fs.exists(finalPath)) ? finalPath : `${repo}/ops/DECISIONS.md`} exists); an orchestrator started on it would resume or find the mission done. Pass archive=1 to move it aside automatically (to ${repo}.prev-<date>), or repo=<new path>; to continue it on purpose, pass fresh=1. Nothing was started.`
    const d = new Date(await $.clock.now())
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
    const dest = `${repo}.prev-${stamp}`
    const mv = await $.process.run(['mv', repo, dest], { timeoutMs: 30000 })
    if (mv.exitCode !== 0) return `orc start: could not move ${repo} aside (${short(mv.stderr, 120)}). Nothing was started.`
    // Clones and snapshots of the old run point at the old path: drop their checkouts (branches stay in the moved repo).
    try { await $.process.run(['/bin/sh', '-c', `rm -rf "${repo}-wt" && git -C "${dest}" worktree prune`], { timeoutMs: 30000 }) } catch { /* best effort */ }
    archived = ` Previous run moved to ${dest}.`
  }
  if (args.mode === 'main') return startMainLab($, { mission, repo, amendment, finalPath, compactAt: args.compactAt, maxAgents: args.maxAgents, archived, auto: args.auto })
  const prompt = orchestratorPrompt(mission, repo, amendment, finalPath)
  const stamp = await $.clock.now()
  const promptPath = `${OUT_DIR}/mission-${stamp}.prompt.md`
  await $.fs.write(promptPath, prompt)
  await relayViaMain($, 'spawn-orchestrator', { description: `orchestrator: ${mission.replace(/.*\//, '')}`, prompt })
  return `orc start: orchestrator prompt written to ${promptPath} for ${mission} (repo ${repo}${amendment ? `, amendment ${amendment}` : ''}, final ${finalPath}).${archived} Do NOT spawn the orchestrator yourself: an "[orc inbox]" item (a prompt when the session is idle, or attached to your next tool result) asks the main loop to spawn it, and later the verifiers and integrators; act on each item exactly as written, once. Watch the /orc pane.`
}

/** The bundled example, next to this plugin. */
async function findExample($: EngineInterface, name = 'wordfreq'): Promise<string | undefined> {
  for (const dir of [`${PLUGIN_ROOT}/examples/${name}`]) {
    if (await $.fs.exists(`${dir}/MISSION.md`)) return dir
  }
  return undefined
}

/** `/orc demo`: run the bundled example end to end (archive a previous run, start, and score it with the hidden suite when the final report lands). */
async function startDemo($: EngineInterface, opts: { name?: string; mode?: 'main' | 'subagent'; compactAt?: number } = {}): Promise<string> {
  const name = (opts.name || 'wordfreq').replace(/[^a-z0-9_-]/gi, '')
  const dir = await findExample($, name)
  if (!dir) return `orc demo: the bundled example examples/${name}/MISSION.md was not found next to the plugin.`
  const current = await read($, demo)
  if (current && !current.scored) {
    const map = (await read($, agents)) ?? {}
    const live = Object.values(map).some(a => a.type.startsWith('orc:') && (a.status === 'running' || a.status === 'pending'))
    if (live) return `orc demo: a demo is already running (started ${ago(current.startedAt, await $.clock.now())}); watch the /orc pane.`
  }
  const amendment = (await $.fs.exists(`${dir}/AMENDMENT.md`)) ? `${dir}/AMENDMENT.md` : undefined
  const text = await startMission($, { mission: `${dir}/MISSION.md`, amendment, archive: true, mode: opts.mode, compactAt: opts.compactAt })
  if (!/orchestrator prompt written|main session is now the orchestrator/.test(text)) return text
  const repo = /(?:\(repo |orchestrator for )([^\s,()]+)/.exec(text)?.[1] ?? `${HOME}/orc-examples/${name}`
  const rec: OrcDemo = { repo, exampleDir: dir, finalPath: `${repo}/ops/FINAL.md`, startedAt: Date.now(), name, mode: opts.mode === 'main' ? 'main' : 'subagent' }
  await update($, demo, () => rec)
  if (opts.mode === 'main') return `orc demo: started the bundled ${name} mission in MAIN mode: this session is now its orchestrator. ${text.replace(/^orc start: /, '')} When the final report lands the owner-held acceptance suite scores it by itself.`
  return `orc demo: started the bundled ${name} mission (repo ${repo}). Nothing more to do but act on each "[orc inbox]" item as it arrives (each spawn once); the /orc pane shows the agents, and when the final report lands the owner-held acceptance suite runs by itself and its score appears here (about 10 minutes). ${text.replace(/^orc start: /, '')}`
}

/** Score a finished demo once: the final report exists and is no longer PENDING, and no orc agent is live. */
async function scoreDemo($: EngineInterface) {
  const d = await read($, demo)
  if (!d || d.scored) return
  if (!(await $.fs.exists(d.finalPath))) return
  const status = /^STATUS:.*$/m.exec(await $.fs.read(d.finalPath))?.[0] ?? ''
  if (!status || /PENDING/i.test(status)) return
  const map = (await read($, agents)) ?? {}
  if (Object.values(map).some(a => a.type.startsWith('orc:') && a.startedAt >= d.startedAt && (a.status === 'running' || a.status === 'pending'))) return
  const cmd = `cd "${d.exampleDir}" && WF_REPO="${d.repo}" WF_FINAL="${d.finalPath}" ORC_REPO="${d.repo}" ORC_FINAL="${d.finalPath}" python3 -W ignore -m unittest hidden.test_hidden 2>&1`
  const ran = await $.process.run(['/bin/sh', '-c', cmd], { timeoutMs: 300000 })
  const out = `${ran.stdout}\n${ran.stderr}`.trim()
  const total = Number(/Ran (\d+) tests?/.exec(out)?.[1] ?? 0)
  const failed = (Number(/failures=(\d+)/.exec(out)?.[1] ?? 0)) + (Number(/errors=(\d+)/.exec(out)?.[1] ?? 0))
  const ok = ran.exitCode === 0 && total > 0
  const passed = Math.max(0, total - failed)
  const scored = { at: await $.clock.now(), passed, total, ok, tail: out.split('\n').slice(-12).join('\n').slice(-1500) }
  await update($, demo, cur0 => (cur0 ? { ...cur0, scored } : cur0))
  const line = `orc demo: hidden acceptance suite ${passed}/${total} ${ok ? 'PASS' : 'FAIL'} · final report ${d.finalPath} · ${status}`
  try { await $.fs.write(`${d.repo}/ops/SCORE.md`, `# Demo score\n\n${line}\n\n\`\`\`\n${scored.tail}\n\`\`\`\n`) } catch { /* best effort */ }
  $.ui.toast(line)
  $.ui.log(line)
  await note($, { kind: 'note', agentId: 'demo', text: line })
  void $.prompt.submit({ text: `orc demo (automatic): finished. ${line}. Tell the user this score in one line (and the file ${d.repo}/ops/SCORE.md); do nothing else.` })
}

// ---- owner intake (packet 1): the WorkHub owner-journey package, two substrate-enforced approvals ----------------

const DRAFTING_CONTRACT = `orc owner intake — how the understanding is reached (adapted from WorkHub owner-journey-031; question discipline after Pocock's grill-me)
You and the owner must mean the same thing before any work starts. Two gates, both decided by the owner in the /orc pane; you have no tool to approve.

PHASE A — INTERVIEW (before gate 1)
1. Restate the owner's request in your own words in two or three sentences, then say what you are unsure about. Do not draft yet.
2. Ask ONE question at a time, the one whose answer changes the most (a criterion, a constraint, an exclusion, a deliverable, the target repository, who the result is for). Offer 2–3 concrete options with your recommended default marked and one line of why; the owner can pick, correct, or add. Stop asking when the answers no longer change the package. Three to six questions is typical; zero is wrong unless the request already pins everything.
3. RESEARCH before you ask: when a term, tool, library, API, file format or fact is unclear, look it up yourself (read the repository, run a command, WebSearch/WebFetch when the session has them). Never ask the owner for something you can find; tell them what you found and what you assumed.
3b. COVERAGE before drafting: make sure each of these is answered by the owner or explicitly out of scope: inputs (sources, formats); outputs (every command, report, file, screen or message they expect, with exact formats where other tools or habits depend on them); behaviour on bad input and errors; scale and speed; where it lives and what it may depend on; documentation; how they will judge it done. Ask about each uncovered category (small ones may share one question). Before you draft, ask once: "Is there anything else you expect it to produce or do?"
4. Keep three kinds of information apart in sourceEvidence.items: "supplied" (the owner said it), "reported_information" (the owner reports a fact about the world), "proposed_interpretation" (you inferred or recommended it). Roles: context | constraint | exclusion | success | deliverable | correction. Every constraint / exclusion / success / deliverable item is covered by exactly where it lands (coverage: itemId → constraints|exclusions|deliverables with a zero-based index, or criteria with the criterion id). A format criterion gives the EXACT shape (an example line), or it is not a criterion.
5. Draft the gate-1 part with mcp__orc__draft_understanding: mission (statement, deliverables), finalPicture (summary, criteria, constraints, exclusions), sourceEvidence, openQuestions (must be empty to request; unresolved ones block). Fix findings, draft again, then present it in plain words — the owner's request next to your interpretation, what you proposed vs what they said — and call mcp__orc__request_understanding. GATE 1 asks the owner: "is this what you mean?"

PHASE B — PLAN AND RULES (after gate 1, before gate 2)
6. Now draft the plan: plan.nodes (objective, runnable acceptanceChecks, dependsOn, criterionIds, resourceKeys = repo-relative paths the node may change) covering every criterion, acyclic; team.roles (producer and reviewer); executionPolicy (model, maxAgents 1–10, maxAttemptsPerNode, maxDurationMinutes, allowedEffects from local_read local_write network publication messaging spend client_data, materialChangeRule, capabilities); capabilities lists every tool or access beyond files and the shell that the work or its checks will use (a browser, a local server, a site, another app, credentials, a device) as {need, why, by: orchestrator|builder|verifier|integrator, permission: what the owner may be asked, if anything}, and is an empty list when there is none. A browser granted to builders or verifiers (by: builder | verifier) gives those workers orc's own headless browser when one is configured. The owner approves them at gate 2; right after approval you use each once so any permission prompt comes while they are present. For page checks, serve the page locally (http://localhost) rather than file:// or an outside site; executionTarget (git_repository: repositoryPath, allowedPaths, requiredCheckIds).
7. RULES ARE RECOMMENDED, NOT IMPOSED: for maxAgents, maxDurationMinutes, allowedEffects, allowedPaths, executionPolicy.mode (normal: you dispatch and accept each child; auto: the approved plan runs as a Workbench graph by rule and you are pinged only on failures, gates and the end, which costs the orchestrator about half the tokens but runs slower; good for long or unattended work) and any constraint you added, record in options[] the chosen default, the alternatives you considered and why. options[] is a top-level array of the package (beside executionPolicy, not inside it), one entry per rule: {"field": "maxAgents", "chosen": "2", "alternatives": ["1 serial", "3 parallel"], "why": "two nodes are independent and the machine is loaded"}. The owner sees these at gate 2 and can correct any of them.
8. Draft again (the full package), fix findings, present the plan and the rules in plain words, then call mcp__orc__request_permission. GATE 2 asks the owner: "approve this plan and these rules?" Only that approval starts work; the substrate generates the mission file from the package and the session (or a subagent, mode=subagent) orchestrates it.

ALWAYS
9. A "correct" decision comes with a note (mcp__orc__owner_context shows it): change only what it asks, keep the old item visible as a sourceEvidence item with role "correction", and request that gate again. "Defer" means wait. After gate 2, a MATERIAL change needs a new version (both gates again); scoped implementation feedback is a mission revision and does not.
10. Software normalises ids (c1.., n1.., r1.., e1..) if you omit them. The package lives in <repo>/ops/orc/ (state.json, UNDERSTANDING.md, MISSION.md at launch) and survives the session: /orc resume picks it up.`

function missionDir(repo: string) { return `${repo.replace(/\/+$/, '')}/ops/orc` }

/** Validate a package the way WorkHub's completeness + coverage rules do, in two stages: 1 = request + interpretation
 *  (gate 1), 2 = plan + rules (gate 2). Returns findings (empty = ready). Normalises ids in place. */
function validateUnderstanding(u: OrcUnderstanding, stage: 1 | 2 = 2): string[] {
  const f: string[] = []
  const str = (x: unknown) => typeof x === 'string' && x.trim().length > 0
  const arr = (x: unknown): x is unknown[] => Array.isArray(x)
  if (!u || typeof u !== 'object') return ['package must be an object']
  if (!u.mission || !str(u.mission.statement)) f.push('mission.statement is required')
  if (!u.mission || !arr(u.mission.deliverables) || u.mission.deliverables.length === 0) f.push('mission.deliverables needs at least one entry')
  if (!u.finalPicture || !str(u.finalPicture.summary)) f.push('finalPicture.summary is required')
  const crit = u.finalPicture && arr(u.finalPicture.criteria) ? u.finalPicture.criteria : []
  if (crit.length === 0) f.push('finalPicture.criteria needs at least one criterion')
  crit.forEach((c, i) => { if (!c.id) c.id = `c${i + 1}`; if (!str(c.description)) f.push(`criterion ${c.id} has no description`) })
  if (u.finalPicture) { u.finalPicture.constraints = arr(u.finalPicture.constraints) ? u.finalPicture.constraints : []; u.finalPicture.exclusions = arr(u.finalPicture.exclusions) ? u.finalPicture.exclusions : [] }
  const critIds = new Set(crit.map(c => c.id))
  const se = u.sourceEvidence
  if (!se || !str(se.originalRequest)) f.push('sourceEvidence.originalRequest is required (the owner\'s own words)')
  else {
    se.items = arr(se.items) ? se.items : []; se.coverage = arr(se.coverage) ? se.coverage : []
    const cls = ['supplied', 'reported_information', 'proposed_interpretation']; const rolesOk = ['context', 'constraint', 'exclusion', 'success', 'deliverable', 'correction']
    se.items.forEach((it, i) => { if (!it.id) it.id = `e${i + 1}`; if (!cls.includes(it.classification)) f.push(`evidence ${it.id}: classification must be one of ${cls.join('|')}`); if (!rolesOk.includes(it.role)) f.push(`evidence ${it.id}: role must be one of ${rolesOk.join('|')}`) })
    const itemIds = new Set(se.items.map(i => i.id))
    for (const c of se.coverage) {
      if (!itemIds.has(c.itemId)) { f.push(`coverage names unknown evidence ${c.itemId}`); continue }
      if (c.field === 'criteria') { if (!critIds.has(c.target)) f.push(`coverage of ${c.itemId} names unknown criterion ${c.target}`) }
      else {
        const list = c.field === 'deliverables' ? (u.mission?.deliverables ?? []) : c.field === 'constraints' ? (u.finalPicture?.constraints ?? []) : c.field === 'exclusions' ? (u.finalPicture?.exclusions ?? []) : undefined
        if (!list) f.push(`coverage of ${c.itemId}: unknown field ${String(c.field)}`)
        else if (!/^\d+$/.test(String(c.target)) || Number(c.target) >= list.length) f.push(`coverage of ${c.itemId}: ${c.field}[${c.target}] does not exist`)
      }
    }
    for (const it of se.items) {
      if (['constraint', 'exclusion', 'success', 'deliverable'].includes(it.role) && !se.coverage.some(c => c.itemId === it.id)) f.push(`evidence ${it.id} (${it.role}: "${short(it.text, 50)}") is not covered by any package field`)
    }
    if (!se.items.some(it => it.classification === 'supplied')) f.push('sourceEvidence has no "supplied" item: record what the owner actually said')
  }
  u.openQuestions = arr(u.openQuestions) ? u.openQuestions : []
  if (u.openQuestions.length) f.push(`${u.openQuestions.length} open question(s) block approval: ${u.openQuestions.map(q => short(q, 60)).join(' | ')}`)
  if (stage === 1) return f
  // ---- stage 2: plan and rules
  const nodes = u.plan && arr(u.plan.nodes) ? u.plan.nodes : []
  if (nodes.length === 0) f.push('plan.nodes needs at least one node')
  nodes.forEach((n, i) => {
    if (!n.id) n.id = `n${i + 1}`
    if (!str(n.objective)) f.push(`node ${n.id} has no objective`)
    if (!arr(n.acceptanceChecks) || n.acceptanceChecks.length === 0) f.push(`node ${n.id} needs at least one runnable acceptance check`)
    n.dependsOn = arr(n.dependsOn) ? n.dependsOn : []
    n.criterionIds = arr(n.criterionIds) ? n.criterionIds : []
    if (n.criterionIds.length === 0) f.push(`node ${n.id} covers no criterion`)
  })
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const n of nodes) {
    for (const d of n.dependsOn) if (!nodeIds.has(d)) f.push(`node ${n.id} depends on unknown node ${d}`)
    for (const c of n.criterionIds) if (!critIds.has(c)) f.push(`node ${n.id} names unknown criterion ${c}`)
  }
  for (const c of crit) if (!nodes.some(n => n.criterionIds.includes(c.id))) f.push(`criterion ${c.id} is covered by no node`)
  const state: Record<string, number> = {}
  const visit = (id: string, path: string[]): void => {
    if (state[id] === 2) return
    if (state[id] === 1) { f.push(`dependency cycle: ${[...path, id].join(' → ')}`); return }
    state[id] = 1
    for (const d of nodes.find(n => n.id === id)?.dependsOn ?? []) visit(d, [...path, id])
    state[id] = 2
  }
  for (const n of nodes) visit(n.id, [])
  const roles = u.team && arr(u.team.roles) ? u.team.roles : []
  roles.forEach((r, i) => { if (!r.id) r.id = `r${i + 1}`; r.nodeIds = arr(r.nodeIds) ? r.nodeIds : []; for (const nid of r.nodeIds) if (!nodeIds.has(nid)) f.push(`role ${r.id} names unknown node ${nid}`) })
  if (!roles.some(r => r.kind === 'producer' && r.nodeIds.length)) f.push('team needs a producer role assigned to at least one node')
  if (!roles.some(r => r.kind === 'reviewer' && r.nodeIds.length)) f.push('team needs a reviewer role assigned to at least one node')
  const p = u.executionPolicy
  if (!p) f.push('executionPolicy is required')
  else {
    if (!str(p.model)) f.push('executionPolicy.model is required (e.g. "inherit")')
    for (const [k, lo, hi] of [['maxAgents', 1, 10], ['maxAttemptsPerNode', 1, 10], ['maxDurationMinutes', 1, 10080]] as const) {
      const v = (p as unknown as Record<string, unknown>)[k]
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) f.push(`executionPolicy.${k} must be an integer in ${lo}..${hi}`)
    }
    if (p.mode !== undefined && p.mode !== 'normal' && p.mode !== 'auto') f.push('executionPolicy.mode must be "normal" or "auto" (or left out for normal)')
    const effects = ['local_read', 'local_write', 'network', 'publication', 'messaging', 'spend', 'client_data']
    if (!arr(p.allowedEffects) || p.allowedEffects.length === 0) f.push('executionPolicy.allowedEffects needs at least local_read')
    else for (const e of p.allowedEffects) if (!effects.includes(e)) f.push(`unknown effect ${e}`)
    if (!str(p.materialChangeRule)) f.push('executionPolicy.materialChangeRule is required (what counts as a material change)')
    if (!arr(p.capabilities)) f.push('executionPolicy.capabilities is required: every tool or access beyond files and the shell the work or its checks will use ({need, why, by, permission}); an empty list when there is none')
    else {
      for (const c of p.capabilities) if (!c || !str(c.need) || !str(c.why) || !str(c.by)) f.push('executionPolicy.capabilities entries need need, why and by')
      // A check that plainly needs a browser, a server, a site or an install, with no capability listed, would stop a
      // run mid-way for a permission (Desktop run 2026-10-08: a phone-width check opened a site and waited for the owner).
      const checks = [...u.finalPicture.criteria.map(c => c.description), ...(u.plan?.nodes ?? []).flatMap(n => n.acceptanceChecks ?? [])].join('\n')
      const hint = /\b(browser|viewport|screenshot|phone[- ]width|\d{3}\s?px\b|playwright|selenium|headless|chrom(e|ium)|safari|firefox|localhost:\d+|https?:\/\/(?!localhost|127\.0\.0\.1)|pip3? install|npm (install|i)\b|curl\s|wget\s)/i.exec(checks)
      if (hint && p.capabilities.length === 0) f.push(`a criterion or check uses "${hint[0]}" but executionPolicy.capabilities is empty: list what it needs (e.g. {need: "built-in browser on http://localhost:<port>", why: "phone-width check", by: "verifier"}) so the owner approves it now, not mid-run`)
    }
  }
  const t = u.executionTarget
  if (!t) f.push('executionTarget is required (kind git_repository, repositoryPath, allowedPaths)')
  else {
    if (t.kind !== 'git_repository') f.push('executionTarget.kind must be git_repository')
    if (!str(t.repositoryPath) || !t.repositoryPath.startsWith('/')) f.push('executionTarget.repositoryPath must be an absolute path')
    else if (isHomeOrRoot(t.repositoryPath)) f.push('executionTarget.repositoryPath is the home folder (or /): choose a project folder for this work; an empty one is fine (orc runs git init there)')
    t.allowedPaths = arr(t.allowedPaths) ? t.allowedPaths : []
    for (const ap of t.allowedPaths) if (ap.startsWith('/') || ap.includes('..')) f.push(`allowedPaths entry "${ap}" must be repo-relative without ..`)
  }
  // Rules are recommended with options (owner direction 2026-10-05): every limit the owner approves carries its alternatives.
  // A number or a list is a fine value for a rule: store it as text rather than refuse the draft (v0.14.0: two redrafts).
  const asText = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v)
  u.options = (arr(u.options) ? u.options : []).map(o => (o && typeof o === 'object' ? { ...o, chosen: asText(o.chosen) as string, alternatives: arr(o.alternatives) ? o.alternatives.map(a => String(asText(a))) : o.alternatives } : o))
  for (const field of ['maxAgents', 'maxDurationMinutes', 'allowedEffects', 'allowedPaths']) {
    const o = u.options.find(x => x.field === field)
    if (!o || !str(o.chosen) || !arr(o.alternatives) || o.alternatives.length === 0 || !str(o.why)) f.push(`options: ${field} needs an entry in the top-level options[] (beside executionPolicy, not inside it): {"field": "${field}", "chosen": "...", "alternatives": ["..."], "why": "..."}`)
  }
  return f
}

function renderUnderstanding(m: OrcMission): string {
  const u = m.understanding
  if (!u) return `# Understanding (v${m.version})\n\nSTATUS: ${m.status}\n\n(no package drafted yet)\n`
  const L: string[] = [`# Understanding v${m.version} — ${m.status}`, '', `Repository: ${m.repo}`, '', '## Mission', u.mission.statement, '', '### Deliverables', ...u.mission.deliverables.map((d, i) => `${i}. ${d}`), '', '## Final picture', u.finalPicture.summary, '', '### Criteria']
  for (const c of u.finalPicture.criteria) L.push(`- ${c.id}: ${c.description}`)
  L.push('', '### Constraints', ...(u.finalPicture.constraints.length ? u.finalPicture.constraints.map((x, i) => `${i}. ${x}`) : ['(none)']), '', '### Exclusions', ...(u.finalPicture.exclusions.length ? u.finalPicture.exclusions.map((x, i) => `${i}. ${x}`) : ['(none)']))
  const nodes = u.plan?.nodes ?? []
  if (nodes.length) {
    L.push('', '## Plan')
    for (const n of nodes) L.push(`- ${n.id}: ${n.objective}`, `  checks: ${(n.acceptanceChecks ?? []).join(' ; ')}`, `  covers: ${(n.criterionIds ?? []).join(', ')}${n.dependsOn?.length ? ` · after: ${n.dependsOn.join(', ')}` : ''}${n.resourceKeys?.length ? ` · may change: ${n.resourceKeys.join(' ')}` : ''}`)
  } else L.push('', '## Plan', '(drafted after gate 1)')
  if (u.team?.roles?.length) L.push('', '## Team', ...u.team.roles.map(r => `- ${r.id} (${r.kind}): ${r.responsibility} → ${(r.nodeIds ?? []).join(', ')}`))
  const p = u.executionPolicy
  if (p) L.push('', '## Execution policy', `model ${p.model} · max agents ${p.maxAgents} · attempts/node ${p.maxAttemptsPerNode} · max ${p.maxDurationMinutes} min · effects ${(p.allowedEffects ?? []).join(', ')}`, `material change: ${p.materialChangeRule}`)
  if (p && (u.plan?.nodes ?? []).length) L.push('', '## The computer', computerLine(m), 'Turn it on for this repository with /orc computer on (the sandbox is set when a session starts: restart, then /orc resume).')
  if (p?.capabilities?.length) L.push('', '## Tools and access this work will use (approved at gate 2, tried once at the start)', ...p.capabilities.map(c => `- ${c.need} · ${c.why} · used by ${c.by}${c.permission ? ` · may ask: ${c.permission}` : ''}`))
  if (u.options?.length) L.push('', '## Rules recommended (default · alternatives · why)', ...u.options.map(o => `- ${o.field}: ${o.chosen} · alternatives: ${o.alternatives.join(', ')} · ${o.why}`))
  if (u.executionTarget) L.push('', '## Execution target', `${u.executionTarget.repositoryPath}${u.executionTarget.baseCommit ? ` @ ${u.executionTarget.baseCommit.slice(0, 12)}` : ''}`, `allowed paths: ${u.executionTarget.allowedPaths.join(' ') || '(whole repository)'}`, `required checks: ${(u.executionTarget.requiredCheckIds ?? []).join(', ') || '(none)'}`)
  L.push('', '## Source evidence', `original request: ${u.sourceEvidence?.originalRequest ?? ''}`, '')
  for (const it of u.sourceEvidence?.items ?? []) L.push(`- ${it.id} [${it.classification} · ${it.role}] ${it.text}${it.source ? ` (${it.source})` : ''}`)
  if (u.openQuestions?.length) L.push('', '## Open questions', ...u.openQuestions.map(q => `- ${q}`))
  if (m.directives?.length) L.push('', '## Owner directives', ...m.directives.map(d => `- ${iso(d.at)} ${d.text}`))
  if (m.decisions.length) L.push('', '## Owner decisions', ...m.decisions.map(d => `- ${iso(d.at)} ${d.gate === 'permission' ? 'plan & rules' : d.gate}: ${d.choice}${d.note ? ` — ${d.note}` : ''}`))
  if (m.snapshot) L.push('', `## Progress (snapshot ${iso(m.snapshot.at)})`, ...m.snapshot.children.map(c => `- ${c.id.slice(0, 7)} ${c.type.replace('orc:', '')} "${short(c.description, 40)}": ${c.status}${c.mark ? ` · ${c.mark}` : ''}${c.merged ? ` · ${c.merged}` : ''}`), `verifications: ${m.snapshot.verifyRequests.map(v => v.stage).join(', ') || 'none'} · integration runs: ${m.snapshot.integrationRuns.map(r => r.status).join(', ') || 'none'}`)
  if (m.backlog?.length) L.push('', '## Backlog', ...m.backlog.map(b => `- [${b.status}] ${b.id}: ${short(b.request, 80)}`))
  if (m.continuations?.length) L.push('', '## Continuations (the owner continued the finished mission; each is the amendment and the approval of its version)', ...m.continuations.map(c => `- v${c.version} ${iso(c.at)} (previous final: ${c.previousFinal ?? 'none'}): ${short(c.request, 160)}`))
  return L.join('\n') + '\n'
}

/** The mission file the existing orchestrator pipeline runs, generated from the approved package. */
function missionFileFrom(m: OrcMission): string {
  const u = m.understanding!
  const L: string[] = [`# Mission: ${short(u.mission.statement, 80)}`, '', u.mission.statement, '', `Repository: \`${m.repo}\``, '', '## Deliverables', ...u.mission.deliverables.map(d => `- ${d}`), '', '## Final picture', u.finalPicture.summary, '']
  if (u.finalPicture.constraints.length) L.push('## Constraints', ...u.finalPicture.constraints.map(c => `- ${c}`), '')
  if (u.finalPicture.exclusions.length) L.push('## Out of scope (exclusions)', ...u.finalPicture.exclusions.map(c => `- ${c}`), '')
  L.push('## Done means')
  u.finalPicture.criteria.forEach((c, i) => {
    const checks = u.plan.nodes.filter(n => n.criterionIds.includes(c.id)).flatMap(n => n.acceptanceChecks)
    L.push(`${i + 1}. ${c.description}${checks.length ? ` — checked by: ${[...new Set(checks)].join(' ; ')}` : ''}`)
  })
  L.push(`${u.finalPicture.criteria.length + 1}. Final report at the path the orchestrator was given: built, verified (commands), deviations, gaps, per-builder account, resumes.`, '')
  L.push('## Suggested work breakdown (the owner-approved plan; keep its node ids in work-order names)')
  for (const n of u.plan.nodes) L.push(`- ${n.id}: ${n.objective}${n.dependsOn.length ? ` (after ${n.dependsOn.join(', ')})` : ''}${n.resourceKeys?.length ? ` · may change: ${n.resourceKeys.join(' ')}` : ''} · checks: ${n.acceptanceChecks.join(' ; ')}`)
  const p = u.executionPolicy
  L.push('', '## Owner-approved limits', `- at most ${p.maxAgents} children at a time; at most ${p.maxAttemptsPerNode} attempts per node; stop and report if the mission exceeds ${p.maxDurationMinutes} minutes`, `- allowed effects: ${p.allowedEffects.join(', ')} (nothing else; no network unless listed)`, `- material change rule: ${p.materialChangeRule}`)
  if (u.executionTarget?.allowedPaths.length) L.push(`- builders may change only: ${u.executionTarget.allowedPaths.join(' ')}`)
  L.push('', `Owner understanding: ${missionDir(m.repo)}/UNDERSTANDING.md (approved v${m.version}).`)
  return L.join('\n') + '\n'
}

async function persistMission($: EngineInterface, m: OrcMission) {
  const dir = missionDir(m.repo)
  refreshPins($, m)
  try {
    await $.fs.write(`${dir}/state.json`, JSON.stringify(m, null, 2))
    await $.fs.write(`${dir}/UNDERSTANDING.md`, renderUnderstanding(m))
  } catch (err) {
    $.ui.log(`orc: mission persist failed: ${String(err)}`)
  }
}

/** The home folder or / is never a project: orc would run git init there and cut clones beside it. */
const isHomeOrRoot = (p: string) => { const x = p.replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, '') || '/'; return x === '/' || x === HOME.replace(/\/+$/, '') }

async function repoOf($: EngineInterface, given?: string): Promise<string> {
  if (given && given.trim()) return given.trim().replace(/^~/, HOME).replace(/\/+$/, '')
  const m = await read($, missionState)
  if (m) return m.repo
  const pwd = await $.process.run(['/bin/sh', '-c', 'git rev-parse --show-toplevel 2>/dev/null || pwd'], { timeoutMs: 5000 })
  return pwd.stdout.trim()
}

async function ownerContext($: EngineInterface, repo: string): Promise<string> {
  const m = await read($, missionState)
  const head = await $.process.run(['git', '-C', repo, 'rev-parse', 'HEAD'], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }))
  const isRepo = head.exitCode === 0
  const prior = (await $.fs.exists(`${repo}/ops/DECISIONS.md`)) ? 'a previous orc run exists under ops/ (its files are moved to ops/history/<stamp>/ when this mission starts)' : 'no previous orc run'
  const last = m?.decisions.slice(-1)[0]
  const lines = [
    DRAFTING_CONTRACT, '',
    `REPOSITORY: ${repo} — ${isRepo ? `git, HEAD ${head.stdout.trim().slice(0, 12)}` : 'NOT a git repository yet (the orchestrator will git init it)'}; ${prior}.`,
    m && m.repo === repo
      ? `MISSION STATE: v${m.version} · ${m.status} · drafted ${m.understanding ? 'yes' : 'no'} · findings ${m.findings.length ? m.findings.join(' | ') : 'none'}${last ? ` · last owner decision: ${last.gate} ${last.choice}${last.note ? ` — "${last.note}"` : ''}` : ''}${m.understanding ? `\nORIGINAL REQUEST: ${m.understanding.sourceEvidence.originalRequest}` : ''}`
      : 'MISSION STATE: none for this repository (use /orc begin <request> or draft directly with repo set).',
    '', 'PACKAGE SHAPE (JSON for mcp__orc__draft_understanding.understanding): { mission: { statement, deliverables[] }, finalPicture: { summary, criteria: [{ id?, description }], constraints[], exclusions[] }, plan: { nodes: [{ id?, objective, acceptanceChecks[], dependsOn[], criterionIds[], resourceKeys?[], testPaths?[], fixesChecks?[] }], testDirs?[] }, team: { roles: [{ id?, kind: producer|reviewer, responsibility, nodeIds[] }] }, executionPolicy: { model, maxAgents, maxAttemptsPerNode, maxDurationMinutes, maxExternalSpendMicros?, allowedEffects[], materialChangeRule, capabilities: [{ need, why, by, permission? }] }, executionTarget: { kind: "git_repository", repositoryPath, baseCommit?, allowedPaths[], requiredCheckIds?[] }, sourceEvidence: { originalRequest, items: [{ id?, text, classification, role, source }], coverage: [{ itemId, field, target }] }, openQuestions[] }',
  ]
  return lines.join('\n')
}

const GATE_QUESTION = {
  understanding: 'Approve this understanding, defer it, or type what to change. Is this what you mean?',
  permission: 'Approving starts the work. Defer, or type what to change. Approve this plan and these rules?',
} as const

/** Ask a pending gate in Claude Code's own question dialog, once, when the session is idle. The answer goes through the
 *  same path as /orc approve|correct|defer; a gate decided meanwhile (pane, command) makes a late answer a no-op. */
async function askGate($: EngineInterface) {
  const m = await read($, missionState)
  if (!m || (m.status !== 'understanding_requested' && m.status !== 'permission_requested')) return
  const gate = m.status === 'understanding_requested' ? 'understanding' : 'permission'
  const key = gateKey(m)
  if (askedGate === key) return
  askedGate = key
  let answer: string
  try {
    const caps = gate === 'permission' ? m.understanding?.executionPolicy?.capabilities ?? [] : []
    const outside = gate === 'permission' && (await sandboxStatus($, m.repo)) === 'off'
    const question = caps.length ? `It will use: ${[...new Set(caps.map(c => c.need))].join('; ')}. ${GATE_QUESTION[gate]}` : GATE_QUESTION[gate]
    answer = (await $.ui.ask(question, { options: outside ? ['Approve', 'Use the computer first', 'Defer'] : ['Approve', 'Defer'], header: gate === 'understanding' ? 'orc gate 1' : 'orc gate 2' })).trim()
  } catch {
    $.ui.status(`gate ${gate === 'understanding' ? 1 : 2} waits for you: the orc pane, or /orc approve · /orc correct <what to change> · /orc defer`)
    return
  }
  const fresh = await read($, missionState)
  if (!fresh || fresh.status !== m.status || fresh.version !== m.version) { $.ui.log('orc: that gate was already decided; the dialog answer was not used.'); return }
  if (answer === 'Use the computer first') {
    for (const line of `${(await computerSwitch($, true)).replace(/^orc computer:\s*/, '')}\nThe gate waits for you there.`.split('\n')) $.ui.log(line)
    return
  }
  const text = answer === 'Approve' ? await recordDecision($, gate, 'approve') : answer === 'Defer' ? await recordDecision($, gate, 'defer') : answer ? await recordDecision($, gate, 'correct', answer) : 'orc: empty answer; the gate still waits.'
  $.ui.status(undefined)
  $.ui.log(text.replace(/^orc:\s*/, ''))
}

async function recordDecision($: EngineInterface, gate: 'understanding' | 'permission', choice: 'approve' | 'correct' | 'defer', noteText?: string): Promise<string> {
  const m = await read($, missionState)
  if (!m) return 'orc: no mission to decide on.'
  const expected = gate === 'understanding' ? 'understanding_requested' : 'permission_requested'
  if (m.status !== expected) return `orc: no ${gate} decision is pending (status ${m.status}).`
  const at = await $.clock.now()
  let next: OrcMission = { ...m, decisions: [...m.decisions, { at, gate, choice, note: noteText?.trim() || undefined }], updatedAt: at }
  if (choice === 'defer') next = { ...next, status: gate === 'understanding' ? 'drafting' : 'understood' }
  // A correction at gate 2 keeps gate 1's approval: the redraft only reopens gate 1 if it changes what gate 1 approved.
  if (choice === 'correct') next = { ...next, status: gate === 'permission' ? 'understood' : 'drafting' }
  if (choice === 'approve') next = gate === 'understanding' ? { ...next, status: 'understood', understandingApprovedAt: at, gate1Digest: gate1DigestOf(m.understanding) } : { ...next, status: 'approved', permissionApprovedAt: at }
  await update($, missionState, () => next)
  await persistMission($, next)
  await note($, { kind: 'note', agentId: 'owner', text: `${gate}: ${choice}${noteText ? ` — ${short(noteText, 50)}` : ''}` })
  let text = `orc: ${gate} ${choice}${noteText ? ` (${short(noteText, 80)})` : ''} recorded at ${iso(at)}.`
  if (choice === 'approve' && gate === 'understanding') text += ' Gate 1 passed: the owner and the model mean the same thing. No work starts. The model now drafts the PLAN and the RULES (defaults with alternatives) and presents them for gate 2 (mcp__orc__request_permission).'
  if (choice === 'approve' && gate === 'permission') text += ' ' + (await launchApprovedMission($))
  if (choice === 'correct') text += ' The model reads the note via mcp__orc__owner_context, revises, and requests again.'
  await inboxPush($, { kind: 'notice', text: `orc owner decision (automatic): ${text} Act on it: ${choice === 'approve' && gate === 'understanding' ? 'draft the plan and the rules now (mcp__orc__draft_understanding with the full package incl. options[]), present them, then mcp__orc__request_permission' : choice === 'approve' ? 'the mission is starting; act on each [orc inbox] item as it comes' : choice === 'correct' ? 'revise the package per the owner\'s note and request again' : 'wait for the owner'}.` })
  return text
}

/** The worker model the owner approved, as the engine names it; undefined means "inherit the configured one". */
function approvedWorkerModel(m: unknown): string | undefined {
  const v = typeof m === 'string' ? m.trim().toLowerCase() : ''
  if (!v || v === 'inherit' || v === 'default') return undefined
  if (/^claude-[a-z0-9.-]+$/.test(v)) return v
  for (const fam of ['opus', 'sonnet', 'haiku', 'fable']) if (v.includes(fam)) return fam
  return undefined
}

/** What gate 1 approves: the mission and the final picture (criteria, constraints, exclusions). Evidence items are not part of
 *  it, because a correction adds one. */
function gate1DigestOf(u: OrcUnderstanding | undefined): string | undefined {
  return u ? digest(JSON.stringify({ mission: u.mission, finalPicture: u.finalPicture })) : undefined
}

/** Permission approved: move a previous run's ops files to ops/history/, generate MISSION.md from the package, start the orchestrator. */
async function launchApprovedMission($: EngineInterface): Promise<string> {
  const m = await read($, missionState)
  if (!m || m.status !== 'approved' || !m.understanding) return 'orc: nothing approved to launch.'
  const dir = missionDir(m.repo)
  await archivePreviousRun($, m.repo)
  // orc creates the repository itself: its own commands run outside Claude Code's sandbox, which (rightly) refuses a
  // sandboxed `git init` (.git/config and .git/hooks are protected). Commits after that are fine inside the sandbox.
  try {
    const inside = await $.process.run(['git', '-C', m.repo, 'rev-parse', '--git-dir'], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1 }))
    if (inside.exitCode !== 0) await $.process.run(['/bin/sh', '-c', `mkdir -p "${m.repo}" && git -C "${m.repo}" init -q`], { timeoutMs: 15000 })
  } catch (err) { $.ui.log(`orc: git init of ${m.repo} failed: ${String(err)}`, { to: 'debug' }) }
  const missionPath = `${dir}/MISSION.md`
  await $.fs.write(missionPath, missionFileFrom(m))
  const at = await $.clock.now()
  if (m.mode === 'subagent') {
    const text = await startMission($, { mission: missionPath, repo: m.repo, final: `${m.repo}/ops/FINAL.md`, fresh: true })
    const started = /orchestrator prompt written/.test(text)
    const next: OrcMission = { ...m, status: started ? 'running' : m.status, startedAt: started ? at : m.startedAt, missionFile: missionPath, updatedAt: at }
    await update($, missionState, () => next)
    await persistMission($, next)
    return started ? `Mission file ${missionPath} generated from the approved understanding; ${text.replace(/^orc start: /, '')}` : text
  }
  // Packet 2 (default): the main session is the orchestrator. A synthetic row carries its state; its children get the
  // full substrate (clones, checks, boundaries, merges, integrator, verifiers); wakes arrive as prompts.
  const row: OrcAgent = { id: MAIN_ORCH, type: 'orc:orchestrator', description: `orchestrator (main session): ${short(m.understanding.mission.statement, 60)}`, status: 'running', startedAt: at, toolCalls: 0, toolErrors: 0, promptChars: 0, steps: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, classes: {}, activities: {}, tools: [], outProseChars: 0, outThinkChars: 0, outArgChars: 0, ctxTokens: 0, ctxMax: 0, ctxFirst: 0, children: 0, runs: 1 }
  await update($, agents, map => ({ ...(map ?? {}), [MAIN_ORCH]: row }))
  const next: OrcMission = { ...m, status: 'running', startedAt: at, missionFile: missionPath, updatedAt: at }
  await update($, missionState, () => next)
  await persistMission($, next)
  await note($, { kind: 'spawn', agentId: MAIN_ORCH, text: `main session is the orchestrator: ${short(m.understanding.mission.statement, 50)}` })
  const auto = m.understanding.executionPolicy?.mode === 'auto'
  const rules = mainRules(missionPath, m.repo, undefined, `${m.repo}/ops/FINAL.md`) + (auto ? autoModeRules(workbenchDir()) + (await prepareStartingBrief($, m.repo, true)) : '')
  const rulesPath = `${OUT_DIR}/mission-${at}.rules.md`
  try { await $.fs.write(rulesPath, rules) } catch { /* best effort */ }
  const acct = await promptAccounting($)
  const base: OrcMission = { ...((await read($, missionState)) ?? next), rulesPath }
  const withRules: OrcMission = { ...base, brief: { chars: orchestratorBrief(base).length, renders: [], spBefore: acct.sp, window: acct.window, windowSource: acct.windowSource } }
  await update($, missionState, () => withRules)
  await persistMission($, withRules)
  const caps = m.understanding.executionPolicy.capabilities ?? []
  // The orc computer: when gate 2 granted workers a browser, orc proves that browser now (a local page at 375 px), so a
  // broken browser surfaces while the owner is here.
  const webRoles = ['builder', 'verifier'].filter(r => browserGranted(m, r))
  const computer = await computerLaunchNote($, m)
  const ownCaps = caps.filter(c => !(webRoles.length && BROWSER && /browser|chrom|viewport|playwright/i.test(c.need)))
  const frontLoad = ownCaps.length ? `\n\nFIRST, before dispatching anything, while the owner is still here: use each approved tool once, in this turn, the way the work will use it (${ownCaps.map(c => c.need).join('; ')}), so any permission prompt comes now and not in the middle of the run. Then tell the owner in one line that setup is done and they can step away. If a permission is refused, stop and say what it blocks. For page checks, serve the page locally (http://localhost) and check it there; never open an outside site to work around a tool limit.` : ''
  await inboxPush($, { kind: 'notice', text: `orc mission (automatic): the owner approved the work.${computer}${frontLoad} ${rules}\n\nMain-session specifics: ${mainSpecifics(m.understanding.executionPolicy.maxAgents)}` })
  return `The main session is now the orchestrator for ${m.repo} (mission file ${missionPath}). Its working rules arrive as the next prompt; builders it dispatches get clones, checks and boundaries; wakes arrive as prompts.`
}

/** Main-mode instructions shared by every launch (owner-approved, lab, resumed). */
function mainSpecifics(cap: number) {
  return `you dispatch builders yourself with the Agent tool (subagent_type "orc:builder", run_in_background true, prompt carrying CHECK:, CHECK_CWD: and MAY_CHANGE: lines); the harness also shows you each child's raw task notification, but act on the "[orc wake]" prompt that follows it, because only the wake carries the registered check result and the boundary audit. Verifiers and the integrator are dispatched through you: mcp__orc__request_verification answers with a SPAWN NOW instruction (spawn it in that same turn), and an "[orc inbox]" block (a prompt when you are idle, or attached to a tool result while you work) asks you to spawn the integrator or re-lists anything not yet done; act on every inbox item once, as written, then continue. Never spawn a verifier or integrator unprompted. The owner-approved limit is ${cap} builders at a time (the substrate refuses more). Between wakes, end your turn; do not poll.`
}
function mainRules(missionPath: string, repo: string, amendment: string | undefined, finalPath: string) {
  return orchestratorPrompt(missionPath, repo, amendment, finalPath)
    .replace(/^You are the orchestrator for the mission in (.+?)\. Read it first, whole\./, 'From now on YOU, the main session, are the orchestrator for the mission in $1. Read it first, whole.')
}

/** Tools the main-session orchestrator uses every wake, and the intake's; pinned (not deferred) only while needed. */
const ORC_LOOP_TOOLS = ['mcp__orc__mark', 'mcp__orc__steer', 'mcp__orc__request_verification', 'mcp__orc__status', 'mcp__orc__directive', 'mcp__orc__run_graph', 'mcp__orc__graph_status', 'mcp__orc__graph_decide']
const ORC_INTAKE_TOOLS = ['mcp__orc__owner_context', 'mcp__orc__draft_understanding', 'mcp__orc__request_understanding', 'mcp__orc__request_permission']
const INTAKE_STATES = ['drafting', 'understanding_requested', 'understood', 'permission_requested']
const mainMissionLive = (m: OrcMission | null | undefined): m is OrcMission => !!m && m.status === 'running' && m.mode === 'main'
/** A finished mission loaded in this session (orchestrated here, or resumed): the owner may ask for more; /orc continue keeps it under orc. */
const missionDoneHere = (m: OrcMission | null | undefined): m is OrcMission => !!m && m.status === 'done' && m.mode !== 'subagent' && !!m.understanding
let pinKey = ''
/** Lab: compaction threshold from config (applies to any main-mode mission; the orchestrator never sees it). */
let LAB_COMPACT_AT: number | undefined
let LAB_MAX_COMPACTIONS = 2
let briefNoted: number | undefined
/** Re-describe the orc tools when the pinned set changes (a tool-list change spends the prompt cache once). */
function refreshPins($: EngineInterface, m: OrcMission | null | undefined) {
  const key = `${mainMissionLive(m)}|${!!m && INTAKE_STATES.includes(m.status)}|${missionDoneHere(m)}`
  if (key === pinKey) return
  pinKey = key
  try { $.ui.invalidate('tool.describe') } catch { /* older engine */ }
  try { $.ui.invalidate('prompt.section') } catch { /* older engine */ }
}

/** The orchestrator brief: a system-prompt section while a main-mode mission runs. It survives compaction (the system
 *  prompt is never summarized) and is stable for the whole mission (no live state, so the prompt cache holds). */
function orchestratorBrief(m: OrcMission): string {
  const cap = m.lab?.maxAgents ?? m.understanding?.executionPolicy?.maxAgents ?? 3
  return [
    '# orc: you are the orchestrator of a running mission',
    `The orc plugin adds this section while the mission in ${m.repo} runs; it stays after compaction. Mission: ${m.missionFile ?? `${missionDir(m.repo)}/MISSION.md`}. Your working rules: ${m.rulesPath ?? 'the "orc mission (automatic)" prompt'}; reread them whenever they are no longer in view.`,
    'You plan, dispatch, judge evidence and record; builders build. The substrate does the mechanics:',
    `- Builders: Agent tool, subagent_type "orc:builder", run_in_background true; the prompt carries CHECK:, CHECK_CWD: and MAY_CHANGE: lines and points at a work order in ops/work-orders/. Each builder gets its own clone, MAY_CHANGE is enforced, the dispatch is preflighted, the CHECK runs when it returns; at most ${cap} builders run at once.`,
    '- Wakes: a returning child produces an "[orc wake]" (a prompt, or inside an "[orc inbox]" block), ordered as you act: STATE, RETURNED, PROVED by the substrate (never redo it), CLAIMED by the child (judge it; spot-check only what the check does not cover), ACTIONABLE. The raw task notification is a duplicate; act on the wake.',
    '- Verdicts: mcp__orc__mark {taskId, verdict accepted|rejected|redo, note} for every returned child; accepted merges its clone.',
    '- Steering: mcp__orc__steer {taskId, message} corrects a child mid-task (it reads the message with its next tool result) or resumes a finished one with it. Use it before a verifier fails work that is still being built, or when a builder misreads its order; a short sentence is enough.',
    '- Verification: mcp__orc__request_verification {stage checkpoint|final|integration}; its result says SPAWN NOW: spawn exactly that verifier, once. Integrators arrive as "[orc inbox]" items; after the first merge the substrate runs ops/integration/check.sh after every merge.',
    '- "[orc inbox]" items are binding: act on each once; never spawn an agent whose description already runs.',
    '- Auto mode (optional): hand the substrate a Workbench brief with mcp__orc__run_graph; it runs builders, verifiers and retries by the brief\'s policy and pings you only by that policy ("[orc graph]"). Look with mcp__orc__graph_status; answer pings with mcp__orc__graph_decide. Do not mark graph children yourself.',
    `- State on demand: mcp__orc__status. Full ledger, for context loss only: ${OUT_DIR}/ledger/main.md. Durable state: ${missionDir(m.repo)}/state.json.`,
    '- After a compaction, or whenever you are unsure what is pending: call mcp__orc__status first, reread your working rules, then act. Never re-dispatch merged or running work; never re-run a registered check.',
    '- Between wakes end your turn; never poll or sleep. Decisions go in ops/DECISIONS.md (numbered, append-only); standing owner rules via mcp__orc__directive.',
  ].join('\n')
}

/** What the compaction summary must keep for the orchestrator to carry on (and what it may drop: the substrate keeps it). */
function compactKeep(m: OrcMission): string {
  return `This session is the orchestrator of the orc mission in ${m.repo} (mission ${m.missionFile ?? '?'}; working rules ${m.rulesPath ?? '?'}). In the summary KEEP: that this session is the orchestrator and must keep orchestrating; the mission goal in one paragraph; every decision and interpretation made so far, one line each, as numbered in ops/DECISIONS.md; every work order and whether it is merged, running, rejected or not yet dispatched; checkpoint and amendment status; open gaps and anything promised to the owner. DROP: full child reports, check outputs, file contents and wake texts; the substrate keeps them in ${OUT_DIR}/ledger/main.md and the repository.`
}

/** Running children, returned-but-unmarked children and verification stages without a report, for one orchestrator run. */
function orchState(map: Record<string, OrcAgent>, orch: OrcAgent) {
  const kids = kidsOf(map, orch)
  const live = (a: OrcAgent) => a.status === 'running' || a.status === 'pending'
  const typeOf = (stage: string) => (stage === 'integration' ? 'orc:integrator' : 'orc:verifier')
  return {
    running: kids.filter(live),
    unmarked: kids.filter(a => !live(a) && !a.mark),
    pendingVer: (orch.verifyRequests ?? []).filter(v => !kids.some(k => baseType(k.type) === typeOf(v.stage) && k.startedAt >= v.at - 2000 && !live(k))).map(v => v.stage as string),
  }
}

async function patchMission($: EngineInterface, fn: (m: OrcMission) => OrcMission) {
  await update($, missionState, cur0 => (cur0 ? fn(cur0) : cur0))
  const m = await read($, missionState)
  if (!m) return
  try { await $.fs.write(`${OUT_DIR}/compactions-${SESSION_ID || 'session'}.json`, JSON.stringify({ repo: m.repo, compactAt: m.lab?.compactAt ?? LAB_COMPACT_AT ?? null, briefChars: orchestratorBrief(m).length, brief: m.brief ?? null, compactions: m.compactions ?? [] }, null, 2)) } catch { /* best effort */ }
}

/** Record a compaction as it starts: the context it hit and the state the orchestrator was in. */
async function compactionStarts($: EngineInterface, trigger: string, ctxBefore: number | undefined): Promise<number> {
  const map = (await read($, agents)) ?? {}
  const orch = map[MAIN_ORCH]
  const st = orch ? orchState(map, orch) : { running: [], unmarked: [], pendingVer: [] }
  const at = await $.clock.now()
  const rec: OrcCompaction = { at, trigger, ctxBefore, state: { running: st.running.map(a => `${a.id.slice(0, 7)} ${short(a.description, 40)}`), unmarked: st.unmarked.map(a => `${a.id.slice(0, 7)} ${short(a.description, 40)}`), pendingVerification: st.pendingVer }, after: [], spawns: [] }
  await patchMission($, m => ({ ...m, compactions: [...(m.compactions ?? []), rec] }))
  await note($, { kind: 'note', agentId: MAIN_ORCH, text: `compaction (${trigger}) at ${ctxBefore ? k(ctxBefore) : '?'} ctx: running ${st.running.length}, unmarked ${st.unmarked.length}, pending verification ${st.pendingVer.length}` })
  return at
}

/** After a compaction: tell the orchestrator where it stands, through the inbox (a prompt when idle, else tool context). */
async function compactionDone($: EngineInterface, at: number) {
  const m = await read($, missionState)
  if (!m) return
  const map = (await read($, agents)) ?? {}
  const orch = map[MAIN_ORCH]
  const st = orch ? orchState(map, orch) : { running: [], unmarked: [], pendingVer: [] }
  const c = (m.compactions ?? []).find(x => x.at === at)
  const list = (xs: OrcAgent[]) => (xs.length ? xs.slice(0, 6).map(a => `${a.id.slice(0, 7)} "${short(a.description, 30)}"`).join(', ') + (xs.length > 6 ? `, +${xs.length - 6} more` : '') : 'none')
  const text = `[orc] The conversation was just compacted${c?.ctxBefore ? ` at ${k(c.ctxBefore)} context` : ''}. You are still the orchestrator of the orc mission in ${m.repo}; the orc section of your system prompt and your working rules (${m.rulesPath ?? 'the orc mission prompt'}) still apply. Now: running ${list(st.running)}; returned and UNMARKED ${list(st.unmarked)}; verification pending: ${st.pendingVer.length ? st.pendingVer.join(', ') : 'none'}. First call mcp__orc__status, then act on what is pending; do not re-dispatch merged or running work.`
  const item = await inboxPush($, { kind: 'notice', text })
  const doneAt = await $.clock.now()
  await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(r => (r.at === at ? { ...r, compactedAt: doneAt, orientId: item.id } : r)) }))
}

/** Recovery log: a main-session tool call right after a compaction (orc's own tools are answered by their dedicated
 *  handlers, which the general tool hook never sees, so those handlers call this too). */
async function logAfterCompaction($: EngineInterface, tool: string, what: string) {
  const mc = await read($, missionState)
  const lastC = mc?.compactions?.slice(-1)[0]
  if (!mainMissionLive(mc) || !lastC?.compactedAt || lastC.after.length >= 12) return
  const atT = await $.clock.now()
  await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(c => (c.at === lastC.at ? { ...c, after: [...c.after, { at: atT, tool, what: short(what, 90) }], statusCalledAt: c.statusCalledAt ?? (tool === 'mcp__orc__status' ? atT : undefined) } : c)) }))
}

/** The engine's own count of system-prompt tokens and the auto-compact window in force (proof the brief is there). */
async function promptAccounting($: EngineInterface): Promise<{ sp?: number; window?: number; windowSource?: string }> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u.context.breakdown
    const sp = b?.categories.find(c => c.kind === 'used' && /system prompt/i.test(c.name))?.tokens
    return { sp, window: b?.maxTokens ?? u.context.window, windowSource: b?.autocompactSource }
  } catch {
    return {}
  }
}

/** Lab: force a compaction of the main session once its context reaches the threshold, only between turns and only at a
 *  hard moment (children running, a return unmarked, or a verification pending). The plugin's own session.compact hook
 *  does not run for its own call, so this path records and orients by itself. */
async function maybeForceCompact($: EngineInterface) {
  const m = await read($, missionState)
  const threshold = m?.lab?.compactAt ?? LAB_COMPACT_AT
  if (!mainMissionLive(m) || !threshold) return
  const forced = (m.compactions ?? []).filter(c => c.trigger === 'forced')
  if (forced.length >= (m.lab?.maxCompactions ?? LAB_MAX_COMPACTIONS)) return
  const now = await $.clock.now()
  const last = (m.compactions ?? []).slice(-1)[0]
  if (last && now - last.at < 120000) return
  if (await read($, cur)) return
  const inbox = (await read($, inboxState)) ?? []
  if (inbox.some(i => !i.ackedAt && i.delivered.some(d => d.via === 'prompt' && now - d.at < 15000))) return
  const tokens = (await $.session.usage()).context.tokens ?? 0
  if (tokens < threshold) return
  const map = (await read($, agents)) ?? {}
  const orch = map[MAIN_ORCH]
  if (!orch) return
  const st = orchState(map, orch)
  if (!st.running.length && !st.unmarked.length && !st.pendingVer.length) return
  const at = await compactionStarts($, 'forced', tokens)
  try {
    const r = await $.session.compact({ instructions: compactKeep(m) })
    if ((r as { skip?: unknown } | undefined)?.skip) { await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(c => (c.at === at ? { ...c, error: 'skipped by a hook' } : c)) })); return }
  } catch (err) {
    await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(c => (c.at === at ? { ...c, error: short(String(err), 200) } : c)) }))
    return
  }
  await compactionDone($, at)
}

// ---- the runner: auto mode (lab: ops/DESIGN-WORKBENCH-AND-RUNNER.md, ops/REPORT-SPIKES-GRAPH-RUNNER.md) ----------------
// The orchestrator hands the substrate a Workbench brief (mcp__orc__run_graph). The substrate spawns each ready node's
// builder (from the tool frame, then from completion hooks; never from the timer, whose spawns escape the hooks), runs
// the node's registered check on return, has the node's verifier check the builder's clone, merges on PASS through the
// mark path, and on FAIL resumes the SAME builder with the fix (its context is kept) within the retry budget, then has
// the SAME verifier re-check narrowly. Decisions are rules in code. The orchestrator is pinged only by the policy
// (every_node | failures_only | phase_end); an exhausted node always pings, because it needs a decision.

/** The Workbench: the copy bundled with the plugin unless the config names another (config "workbenchDir"). */
const workbenchDir = () => (WORKBENCH_DIR || `${PLUGIN_ROOT}/workbench`).replace(/^~/, HOME)
let WORKBENCH_DIR = ''
/** Lab only (config labInjectVerifierDefect): the first verifier PASS of a graph run is turned into this defect, so the
 *  same-builder fix and the same-verifier narrow re-check run deterministically. Off unless set. */
let LAB_INJECT_DEFECT = ''

function graphOf(m: OrcMission | null | undefined): OrcGraph | undefined {
  return m?.graph
}

async function patchGraph($: EngineInterface, fn: (g: OrcGraph) => OrcGraph) {
  await patchMission($, m => (m.graph ? { ...m, graph: fn(m.graph) } : m))
  const m = await read($, missionState)
  if (m) { try { await persistMission($, m) } catch { /* best effort */ } }
}

async function patchNode($: EngineInterface, id: string, fn: (n: OrcGraphNode) => OrcGraphNode) {
  await patchGraph($, g => ({ ...g, nodes: g.nodes.map(n => (n.id === id ? fn(n) : n)) }))
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Preflight a brief with the Workbench when it is installed; a block refuses the run. Returns [ok, summary]. */
async function preflightBrief($: EngineInterface, briefPath: string): Promise<[boolean, string]> {
  const dir = workbenchDir()
  if (!(await $.fs.exists(`${dir}/workbench/__main__.py`))) return [true, `workbench not found at ${dir}: structural checks only`]
  try {
    const r = await $.process.run(['/bin/sh', '-c', `PYTHONPATH="${dir}" python3 -m workbench preflight --json "${briefPath}"`], { timeoutMs: 60000 })
    if (r.exitCode === 2) return [false, `workbench preflight: bad input: ${short(r.stderr.trim() || r.stdout.trim(), 300)}`]
    const d = JSON.parse(r.stdout) as { ready?: boolean; findings?: { id: string; severity: string; where: string; message: string; fix: string }[] }
    const blocks = (d.findings ?? []).filter(f => f.severity === 'block')
    const warns = (d.findings ?? []).filter(f => f.severity !== 'block')
    const lines = blocks.slice(0, 8).map(f => `BLOCK ${f.id} ${f.where}: ${short(f.message, 120)} — fix: ${short(f.fix, 120)}`)
    return [blocks.length === 0, `workbench preflight: ${blocks.length} block, ${warns.length} warn${lines.length ? '\n' + lines.join('\n') : ''}`]
  } catch (err) {
    return [true, `workbench preflight could not run (${short(String(err), 100)}): structural checks only`]
  }
}

/** Structural checks the runner itself needs, whether or not the Workbench is installed. */
function structural(nodes: OrcGraphNode[]): string[] {
  const ids = new Set(nodes.map(n => n.id))
  const out: string[] = []
  if (ids.size !== nodes.length) out.push('node ids are not unique')
  for (const n of nodes) for (const d of n.dependsOn) if (!ids.has(d)) out.push(`node ${n.id} depends on unknown ${d}`)
  const state: Record<string, number> = {}
  const visit = (id: string): boolean => {
    if (state[id] === 1) return true
    if (state[id] === 2) return false
    state[id] = 1
    const n = nodes.find(x => x.id === id)
    for (const d of n?.dependsOn ?? []) if (visit(d)) return true
    state[id] = 2
    return false
  }
  for (const n of nodes) if (visit(n.id)) { out.push(`dependency cycle through ${n.id}`); break }
  for (const n of nodes) if (!str(n.spec.check).trim()) out.push(`node ${n.id} has no check`)
  return out
}

/** Files a check tests for (test -f/-e/-d/-s X, [ -f X ]): relative paths only, quotes stripped. */
function testedPaths(check: string): string[] {
  const out: string[] = []
  const re = /(?:\btest|\[)\s+-[efdsr]\s+("[^"]+"|'[^']+'|[^\s;&|)\]]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(check))) {
    const raw = m[1]!.replace(/^["']|["']$/g, '')
    if (!raw || raw.startsWith('/') || raw.startsWith('~') || raw.includes('$')) continue
    out.push(raw.replace(/^\.\//, ''))
  }
  return out
}

async function unproducedPaths($: EngineInterface, repo: string, nodes: OrcGraphNode[]): Promise<string[]> {
  const produced = nodes.flatMap(n => [...strs(n.spec.outputs), ...strs(n.spec.paths)]).map(x => x.replace(/^\.\//, ''))
  const covers = (a: string, b: string) => a === b || b.startsWith(a.endsWith('/') ? a : `${a}/`)
  const out: string[] = []
  for (const n of nodes) {
    for (const path of testedPaths(str(n.spec.check))) {
      if (produced.some(x => covers(x, path))) continue
      if (await $.fs.exists(`${repo}/${path}`)) continue
      out.push(`node ${n.id}'s check tests for ${path}, which no node outputs or may change and which does not exist (fix: add it to a node's outputs and paths, or drop it from the check)`)
    }
  }
  return out
}

async function startGraph($: EngineInterface, briefArg: string): Promise<string> {
  const m = await read($, missionState)
  if (!mainMissionLive(m)) return 'orc run_graph: needs a running main-mode mission (this session as orchestrator).'
  if (m.graph && (m.graph.status === 'running' || m.graph.status === 'waiting')) return `orc run_graph: a graph is already running (${m.graph.briefPath}); see mcp__orc__graph_status.`
  const briefPath = briefArg.replace(/^~/, HOME).startsWith('/') ? briefArg.replace(/^~/, HOME) : `${m.repo}/${briefArg}`
  if (!(await $.fs.exists(briefPath))) return `orc run_graph: brief not found: ${briefPath}`
  let brief: Record<string, unknown>
  try { brief = JSON.parse(await $.fs.read(briefPath)) as Record<string, unknown> } catch (err) { return `orc run_graph: brief is not JSON: ${short(String(err), 120)}` }
  const [ok, pf] = await preflightBrief($, briefPath)
  if (!ok) return `orc run_graph: REFUSED, the brief does not pass preflight. Fix it and call again.\n${pf}`
  const pol = (brief.policy ?? {}) as Record<string, unknown>
  const cap = m.lab?.maxAgents ?? m.understanding?.executionPolicy?.maxAgents ?? 3
  const pv = pol.verify
  const modeOf = (n: Record<string, unknown>, workType: string): 'per_node' | 'gates_only' => {
    if (Number(brief.workbench_brief) !== 2) return 'per_node'
    const own = str(n.verify)
    if (own === 'per_node' || own === 'gates_only') return own
    if (pv && typeof pv === 'object') return str((pv as Record<string, unknown>)[workType]) === 'gates_only' ? 'gates_only' : 'per_node'
    return str(pv) === 'gates_only' ? 'gates_only' : 'per_node'
  }
  const nodes: OrcGraphNode[] = (Array.isArray(brief.nodes) ? brief.nodes : []).map(n0 => {
    const n = n0 as Record<string, unknown>
    const workType = str(n.work_type) || 'code'
    return { id: str(n.id), role: str(n.role) || 'builder', workType, objective: str(n.objective), dependsOn: strs(n.depends_on), status: 'pending' as const, attempts: 0, verifyMode: modeOf(n, workType), spec: n }
  })
  if (!nodes.length) return 'orc run_graph: the brief has no nodes.'
  const problems = [...structural(nodes), ...(await unproducedPaths($, m.repo, nodes))]
  if (problems.length) return `orc run_graph: REFUSED: ${problems.join('; ')}`
  const ping = str(pol.ping) === 'every_node' ? 'every_node' : str(pol.ping) === 'phase_end' ? 'phase_end' : 'failures_only'
  const graph: OrcGraph = {
    briefPath, goal: str(brief.goal), status: 'running', startedAt: await $.clock.now(), pings: [], preflight: pf,
    criteria: Object.fromEntries((Array.isArray(brief.criteria) ? brief.criteria : []).map(c0 => { const c = c0 as Record<string, unknown>; return [str(c.id), str(c.text)] }).filter(([k]) => k)),
    policy: { retryBudget: Math.max(0, Number(pol.retry_budget_per_node ?? 2) || 0), maxParallel: Math.max(1, Math.min(cap, Number(pol.max_parallel ?? cap) || cap)), ping },
    nodes,
    gates: (Array.isArray(brief.gates) ? brief.gates : []).map(g0 => { const g = g0 as Record<string, unknown>; return { id: str(g.id), kind: str(g.kind) || 'checkpoint', after: strs(g.after) } }),
  }
  await patchMission($, x => ({ ...x, graph }))
  await note($, { kind: 'spawn', agentId: MAIN_ORCH, text: `graph run started: ${nodes.length} nodes, retry ${graph.policy.retryBudget}, parallel ${graph.policy.maxParallel}, ping ${graph.policy.ping}` })
  const started = await graphPump($)
  const gatesOnly = nodes.filter(n => n.verifyMode === 'gates_only').length
  return `orc run_graph: running ${briefPath} in auto mode: ${nodes.length} nodes (${gatesOnly} verified at the gates only, ${nodes.length - gatesOnly} per node), retry budget ${graph.policy.retryBudget} per node, ${graph.policy.maxParallel} in parallel, ping ${graph.policy.ping}. Started now: ${started.join(', ') || 'none'}. ${pf}\nYou will be pinged only by that policy (an exhausted node always pings). End your turn now; pull mcp__orc__graph_status when you want a look; answer pings with mcp__orc__graph_decide.`
}

/** Auto mode: while the graph's integrator node has not passed, merges are not integration-checked unless a check from
 *  an earlier phase is committed. A check written at the first merge describes the whole deliverable set, so every merge
 *  before the last failed on work still in flight (v0.14.0: a diagnosis integrator and a wake per run, no finding). */
function graphIntegratorPending(m: OrcMission | null | undefined): OrcGraphNode | undefined {
  const g = graphOf(m)
  if (!g || g.status === 'done' || g.status === 'aborted') return undefined
  return g.nodes.find(n => n.role === 'integrator' && n.status !== 'passed' && n.status !== 'skipped')
}

function builderPrompt(g: OrcGraph, n: OrcGraphNode, repo: string): string {
  const s = n.spec
  const check = str(s.check).split('\n').map(l => l.trim()).filter(Boolean).join(' && ')
  const profile = [
    s.browser_check ? `Browser check the verifier will run: ${JSON.stringify(s.browser_check)}` : '',
    strs(s.sources).length ? `Sources (cite them as the claims check says): ${strs(s.sources).join(', ')}; claims check: ${str(s.claims_check)}` : '',
    strs(s.checked_against).length ? `Checked against: ${strs(s.checked_against).join(', ')}` : '',
  ].filter(Boolean)
  return [
    `You are building node ${n.id} of a work brief (${n.workType} work). Objective: ${n.objective}`,
    g.goal ? `The goal of the whole work, in the owner's words: ${g.goal}` : '',
    strs(s.inputs).length ? `Inputs to read: ${strs(s.inputs).join(', ')}` : '',
    strs(s.outputs).length ? `Outputs to produce: ${strs(s.outputs).join(', ')}` : '',
    strs(s.criteria).length ? `Criteria this node serves: ${strs(s.criteria).map(c => (g.criteria?.[c] ? `${c} (${g.criteria[c]})` : c)).join('; ')}` : '',
    ...profile,
    ...(n.role === 'integrator' ? [
      'You are the integrator node: every node you depend on has merged, and your clone was cut from that HEAD. Make their work hold together; never change their files (they are outside your paths). A defect in their work goes in your report under DEVIATIONS, one line each: the command, the evidence, the node that most likely owns it.',
      strs(s.paths).some(x => x.replace(/^\.\//, '').startsWith('ops/integration')) ? `The integration check is yours: ${CHECK_SCRIPT_GUIDE('every criterion listed above', undefined)} The substrate runs it after every later merge.` : '',
    ] : []),
    'Work only inside the paths below, in your own clone; commit your work by name; run the check yourself before you report. An independent verifier checks your clone afterwards; if it finds defects you will be sent them and asked to fix them here, with your context intact.',
    `CHECK: ${check}`,
    `CHECK_CWD: ${repo}`,
    `MAY_CHANGE: ${strs(s.paths).join(' ')}`,
  ].filter(Boolean).join('\n')
}

function verifierPrompt(g: OrcGraph, n: OrcGraphNode, clone: string, branch: string): string {
  const s = n.spec
  const check = str(s.check).split('\n').map(l => l.trim()).filter(Boolean).join(' && ')
  const profile = n.workType === 'frontend' ? `This is frontend work: run the browser check ${JSON.stringify(s.browser_check ?? {})} if you can open the target; otherwise say it is NOT CHECKED.`
    : n.workType === 'research' ? `This is research work: every claim must cite one of ${JSON.stringify(strs(s.sources))} as the claims check says (${str(s.claims_check)}); open the cited sources you can.`
    : n.workType === 'docs' ? `This is docs work: check the text against ${JSON.stringify(strs(s.checked_against))}.`
    : 'This is code work: run the check, read the diff, and look for what the check does not cover.'
  return [
    `You verify node ${n.id} of a work brief, independently, read-only. The builder's work is committed in its clone ${clone} (branch ${branch}). Work only there and change nothing.`,
    `Objective: ${n.objective}`,
    strs(s.outputs).length ? `Expected outputs: ${strs(s.outputs).join(', ')}` : '',
    strs(s.criteria).length ? `Criteria: ${strs(s.criteria).map(c => (g.criteria?.[c] ? `${c} (${g.criteria[c]})` : c)).join('; ')}` : '',
    `The node's check (run it yourself, from the clone): ${check}`,
    profile,
    'Report in exactly this shape: VERDICT: PASS|FAIL (one line). DEFECTS: one line each, with the exact fix the builder should make, or none. NOT CHECKED: at most 3 lines.',
  ].filter(Boolean).join('\n')
}

/** Spawn every ready node (all dependencies passed or skipped) up to max parallel. Returns the node ids started. */
async function graphPump($: EngineInterface): Promise<string[]> {
  const m = await read($, missionState)
  const g = graphOf(m)
  if (!m || !g || g.status !== 'running') return []
  const done = new Set(g.nodes.filter(n => n.status === 'passed' || n.status === 'skipped').map(n => n.id))
  const active = g.nodes.filter(n => n.status === 'building' || n.status === 'verifying' || n.status === 'retrying').length
  const ready = g.nodes.filter(n => n.status === 'pending' && n.dependsOn.every(d => done.has(d)))
  const started: string[] = []
  for (const n of ready.slice(0, Math.max(0, g.policy.maxParallel - active))) {
    try {
      const r = await $.agent.spawn({ subagentType: 'orc:builder', description: `graph ${n.id}: ${short(n.objective, 48)}`, prompt: builderPrompt(g, n, m.repo) })
      const id = (r as { agentId?: string }).agentId
      if (!id) { $.ui.log(`orc graph: spawn of ${n.id} refused: ${JSON.stringify(r)}`); continue }
      const at = await $.clock.now()
      await patchNode($, n.id, x => ({ ...x, status: 'building', builderId: id, attempts: 0, startedAt: at }))
      started.push(n.id)
    } catch (err) {
      $.ui.log(`orc graph: spawn of ${n.id} failed: ${String(err)}`)
    }
  }
  return started
}

async function graphPing($: EngineInterface, text: string) {
  const at = await $.clock.now()
  await patchGraph($, g => ({ ...g, pings: [...g.pings, { at, text: short(text, 400) }].slice(-40) }))
  await inboxPush($, { kind: 'wake', text: `[orc graph] ${text}` })
}

/** Is this agent a builder or verifier of the running graph? */
async function graphNodeOf($: EngineInterface, agentId: string): Promise<{ node: OrcGraphNode; as: 'builder' | 'verifier' } | undefined> {
  const g = graphOf(await read($, missionState))
  if (!g) return undefined
  for (const n of g.nodes) {
    if (n.builderId === agentId) return { node: n, as: 'builder' }
    if (n.verifierId === agentId) return { node: n, as: 'verifier' }
  }
  return undefined
}

async function retryOrFail($: EngineInterface, n: OrcGraphNode, failure: string) {
  const g = graphOf(await read($, missionState))
  if (!g || !n.builderId) return
  if (n.attempts < g.policy.retryBudget) {
    const attempt = n.attempts + 1
    await patchNode($, n.id, x => ({ ...x, status: 'retrying', attempts: attempt, lastFailure: short(failure, 600) }))
    await note($, { kind: 'send', agentId: n.builderId, text: `graph ${n.id}: retry ${attempt}/${g.policy.retryBudget} → same builder` })
    await $.session.send({ to: { agentId: n.builderId }, text: `FIX REQUIRED for node ${n.id} (retry ${attempt} of ${g.policy.retryBudget}). ${failure}\nFix exactly this in your clone, re-run the check, commit by name, and report again in the builder shape.` })
    if (g.policy.ping === 'every_node') await graphPing($, `node ${n.id} failed and went back to its builder (retry ${attempt}/${g.policy.retryBudget}): ${short(failure, 200)}`)
    return
  }
  const at = await $.clock.now()
  await patchNode($, n.id, x => ({ ...x, status: 'failed', endedAt: at, lastFailure: short(failure, 600) }))
  await graphPing($, `node ${n.id} "${short(n.objective, 50)}" FAILED after ${n.attempts} retries (budget ${g.policy.retryBudget}). Last failure: ${short(failure, 300)}\nIts dependents wait. Decide with mcp__orc__graph_decide {node: "${n.id}", action: "retry"|"skip"|"abort", note} (retry grants one more attempt with your note as the fix).`)
  await graphSettle($)
}

/** After a node passes: gates reached, completion, and the next ready nodes. */
async function graphAdvance($: EngineInterface, n: OrcGraphNode) {
  const g0 = graphOf(await read($, missionState))
  if (!g0) return
  if (g0.policy.ping === 'every_node') await graphPing($, `node ${n.id} "${short(n.objective, 50)}" passed and merged.`)
  const g = graphOf(await read($, missionState))!
  const ok = new Set(g.nodes.filter(x => x.status === 'passed' || x.status === 'skipped').map(x => x.id))
  for (const gate of g.gates.filter(x => !x.reachedAt && x.after.length && x.after.every(a => ok.has(a)))) {
    const at = await $.clock.now()
    await patchGraph($, gg => ({ ...gg, gates: gg.gates.map(x => (x.id === gate.id ? { ...x, reachedAt: at } : x)) }))
    const covered = g.nodes.filter(x => x.verifyMode === 'gates_only' && x.status === 'passed').map(x => x.id)
    await graphPing($, `gate ${gate.id} (${gate.kind}) reached: ${gate.after.join(', ')} passed. Request it as the working rules say: mcp__orc__request_verification {stage: "${gate.kind === 'final' ? 'final' : 'checkpoint'}"}.${covered.length ? ` These nodes merged on their own checks and have had no independent verifier yet; the gate's verification covers them: ${covered.join(', ')}.` : ''}`)
  }
  await graphPump($)
  await graphSettle($)
}

/** The run ends when every node passed or was skipped; it waits when nothing can move because a node failed. */
async function graphSettle($: EngineInterface) {
  const g = graphOf(await read($, missionState))
  if (!g || g.status !== 'running') return
  const busy = g.nodes.some(n => n.status === 'building' || n.status === 'verifying' || n.status === 'retrying')
  if (busy) return
  if (g.nodes.every(n => n.status === 'passed' || n.status === 'skipped')) {
    const at = await $.clock.now()
    await patchGraph($, gg => ({ ...gg, status: 'done', endedAt: at }))
    const skipped = g.nodes.filter(n => n.status === 'skipped').map(n => n.id)
    await graphPing($, `graph done: ${g.nodes.length} nodes, all passed and merged${skipped.length ? ` (skipped by your decision: ${skipped.join(', ')})` : ''}, in ${clock(at - g.startedAt)}. Retries used: ${g.nodes.reduce((a, n) => a + n.attempts, 0)}. Continue as the working rules say (integration and final verification).`)
    return
  }
  const done = new Set(g.nodes.filter(n => n.status === 'passed' || n.status === 'skipped').map(n => n.id))
  const canStart = g.nodes.some(n => n.status === 'pending' && n.dependsOn.every(d => done.has(d)))
  if (!canStart) await patchGraph($, gg => ({ ...gg, status: 'waiting' }))
}

/** A graph child returned (from the completion hook): the rules decide the next step. */
async function graphOnReturn($: EngineInterface, row: OrcAgent, reason: string, answer: string) {
  const hit = await graphNodeOf($, row.id)
  if (!hit) return
  const fresh = ((await read($, agents)) ?? {})[row.id] ?? row
  const n = hit.node
  if (hit.as === 'builder') {
    const cr = fresh.checkResult
    if (reason !== 'answer') return retryOrFail($, n, `The builder ended with "${reason}" before reporting.`)
    const outside = fresh.boundaryReport?.outside ?? []
    if (outside.length) return retryOrFail($, n, `The builder changed files outside its MAY_CHANGE paths: ${outside.slice(0, 8).join(', ')}. Undo those changes (they are not yours to make) and keep the work inside your paths.`)
    if (!cr || cr.status !== 'pass') return retryOrFail($, n, `The node's registered check ${cr ? cr.status.toUpperCase() : 'did not run'}${cr?.exitCode != null ? ` (exit ${cr.exitCode})` : ''}. Output tail:\n${tailLines(cr?.outputTail ?? cr?.reason ?? '', 15)}`)
    const wt = fresh.worktree
    if (n.verifyMode === 'gates_only' && !n.verifierId) {
      await acceptNode($, n, `check PASS, boundary clean; verified at the gate (gates_only)${n.attempts ? ` after ${n.attempts} retr${n.attempts === 1 ? 'y' : 'ies'}` : ''}`)
      return
    }
    if (n.verifierId) {
      await patchNode($, n.id, x => ({ ...x, status: 'verifying' }))
      await $.session.send({ to: { agentId: n.verifierId }, text: `The builder of node ${n.id} fixed what you reported; its registered check passes again. Its report:\n${short(answer, 1500)}\nRe-check ONLY the defects you reported (in the same clone), then answer in the same shape: VERDICT, DEFECTS, NOT CHECKED.` })
      return
    }
    try {
      const r = await $.agent.spawn({ subagentType: 'orc:verifier', description: `graph verify ${n.id}: ${short(n.objective, 40)}`, prompt: verifierPrompt(graphOf(await read($, missionState))!, n, wt?.path ?? '(no clone)', wt?.branch ?? '?') })
      const id = (r as { agentId?: string }).agentId
      if (id) await patchNode($, n.id, x => ({ ...x, status: 'verifying', verifierId: id }))
      else await graphPing($, `node ${n.id}: its verifier could not be spawned (${short(JSON.stringify(r), 120)}); decide with mcp__orc__graph_decide.`)
    } catch (err) {
      await graphPing($, `node ${n.id}: its verifier could not be spawned (${short(String(err), 120)}); decide with mcp__orc__graph_decide.`)
    }
    return
  }
  // verifier
  const pass = /VERDICT:\s*\**\s*PASS/i.test(answer) && !/VERDICT:\s*\**\s*FAIL/i.test(answer)
  if (!pass) {
    const defects = /DEFECTS:([\s\S]*?)(NOT CHECKED:|$)/i.exec(answer)?.[1]?.trim() || short(answer, 800)
    return retryOrFail($, n, `The verifier found:\n${short(defects, 1200)}`)
  }
  if (!n.builderId) return
  const gNow = graphOf(await read($, missionState))
  if (LAB_INJECT_DEFECT && gNow && !gNow.injected) {
    await patchGraph($, gg => ({ ...gg, injected: true }))
    await note($, { kind: 'note', agentId: n.builderId, text: `lab fault injection on ${n.id}: verifier PASS turned into a defect` })
    return retryOrFail($, n, `The verifier found:\n- ${LAB_INJECT_DEFECT} (lab fault injection: a planted defect that exercises the same-builder fix and the narrow re-check)`)
  }
  await $.tool.call({ tool: 'mcp__orc__mark', taskId: row.id, verdict: 'accepted', note: `graph ${n.id}: verifier PASS` } as never)
  await acceptNode($, n, `check PASS and verifier PASS${n.attempts ? ` after ${n.attempts} retr${n.attempts === 1 ? 'y' : 'ies'}` : ''}`)
}

/** Accept a node's builder through the mark path (merge), then advance the graph; a merge conflict fails the node. */
async function acceptNode($: EngineInterface, n: OrcGraphNode, why: string) {
  if (!n.builderId) return
  const res = await $.tool.call({ tool: 'mcp__orc__mark', taskId: n.builderId, verdict: 'accepted', note: `graph ${n.id}: ${why}` } as never) as { text?: string; deny?: string }
  const merged = ((await read($, agents)) ?? {})[n.builderId]?.worktree?.merged
  const at = await $.clock.now()
  if (merged === 'conflict' || merged === 'error') {
    await patchNode($, n.id, x => ({ ...x, status: 'failed', endedAt: at, lastFailure: `merge ${merged}: ${short(res?.text ?? res?.deny ?? '', 300)}` }))
    await graphPing($, `node ${n.id} passed its checks but its merge ${merged === 'conflict' ? 'CONFLICTED' : 'failed'}: ${short(res?.text ?? '', 200)}. Decide with mcp__orc__graph_decide (retry re-runs the node on the new HEAD).`)
    await graphSettle($)
    return
  }
  await patchNode($, n.id, x => ({ ...x, status: 'passed', endedAt: at }))
  // A merge needs an integration check: in auto mode the runner dispatches its integrator from this hook, once the
  // graph's integrator node (if any) has passed; that node may have written the check itself.
  try {
    const map2 = (await read($, agents)) ?? {}
    const orch = map2[MAIN_ORCH]
    const m2 = await read($, missionState)
    if (orch?.integration?.due && m2 && !graphIntegratorPending(m2) && !(await $.fs.exists(`${m2.repo}/ops/integration/check.sh`))) await dispatchIntegrator($, map2, orch, m2.repo, `after graph ${n.id}: author the integration check`, true)
  } catch (err) { $.ui.log(`orc graph: integrator dispatch failed: ${String(err)}`, { to: 'debug' }) }
  await graphAdvance($, { ...n, status: 'passed' })
}

/** Auto mode: the substrate's own integrator returning with its check passing is accepted by the runner (no wake);
 *  a failing one still wakes the orchestrator, because that needs a decision. */
async function graphOwnsIntegrator($: EngineInterface, row: OrcAgent): Promise<boolean> {
  const m = await read($, missionState)
  // Only an integrator the runner spawned itself: one the orchestrator requested (or the integration check dispatched
  // after a FAIL) is the orchestrator's to read, so it wakes it as usual. (A6 comparison: the runner swallowed a
  // requested integration pass by its name and the orchestrator waited 22 minutes.)
  if (!m?.graph || m.graph.status === 'aborted' || row.type !== 'orc:integrator' || !(m.graph.runnerIntegrators ?? []).includes(row.id)) return false
  const fresh = ((await read($, agents)) ?? {})[row.id] ?? row
  if (fresh.checkResult?.status !== 'pass') return false
  await $.tool.call({ tool: 'mcp__orc__mark', taskId: row.id, verdict: 'accepted', note: 'auto mode: integration check authored and passing (accepted by the runner)' } as never)
  if (m.graph.policy.ping === 'every_node') await graphPing($, `the integration check is in place and passing (${short(row.description, 60)}).`)
  return true
}

async function graphDecide($: EngineInterface, nodeId: string, action: string, noteText: string): Promise<string> {
  const m = await read($, missionState)
  const g = graphOf(m)
  if (!g) return 'orc graph_decide: no graph run.'
  if (action === 'abort') {
    const at = await $.clock.now()
    await patchGraph($, gg => ({ ...gg, status: 'aborted', endedAt: at }))
    return `orc graph_decide: graph aborted; nothing new starts. Running agents finish on their own; mark them as usual. ${noteText ? `Note: ${noteText}` : ''}`
  }
  const n = g.nodes.find(x => x.id === nodeId)
  if (!n) return `orc graph_decide: no node "${nodeId}" (nodes: ${g.nodes.map(x => x.id).join(', ')})`
  if (action === 'skip') {
    await patchNode($, n.id, x => ({ ...x, status: 'skipped', lastFailure: `${x.lastFailure ?? ''} · skipped by the orchestrator: ${noteText}` }))
    await patchGraph($, gg => ({ ...gg, status: 'running' }))
    await graphAdvance($, { ...n, status: 'skipped' })
    return `orc graph_decide: ${n.id} skipped (its dependents may start; record the gap in DECISIONS and the final report).`
  }
  if (action === 'retry') {
    await patchGraph($, gg => ({ ...gg, status: 'running' }))
    if (n.builderId && n.status === 'failed') {
      await patchNode($, n.id, x => ({ ...x, status: 'retrying', attempts: x.attempts + 1 }))
      await $.session.send({ to: { agentId: n.builderId }, text: `FIX REQUIRED for node ${n.id} (an extra attempt granted by the orchestrator). ${noteText || n.lastFailure || ''}\nFix it in your clone, re-run the check, commit by name, and report again in the builder shape.` })
      return `orc graph_decide: ${n.id} sent back to its builder with your note.`
    }
    await patchNode($, n.id, x => ({ ...x, status: 'pending', builderId: undefined, verifierId: undefined, attempts: 0 }))
    const started = await graphPump($)
    return `orc graph_decide: ${n.id} reset to run again from HEAD${started.includes(n.id) ? ' (started)' : ''}.`
  }
  return 'orc graph_decide: action must be retry, skip or abort.'
}

function graphStatusText(g: OrcGraph, now: number): string {
  const row = (n: OrcGraphNode) => `${n.id.padEnd(6)} ${n.status.padEnd(9)} ${n.verifyMode === 'gates_only' ? 'gates ' : 'node  '} ${n.attempts ? `retries ${n.attempts}` : '         '} ${short(n.objective, 50)}${n.lastFailure && n.status !== 'passed' ? ` — last failure: ${short(n.lastFailure, 80)}` : ''}`
  return [
    `[orc graph] ${g.status} · ${g.briefPath} · ${clock(now - g.startedAt)} · policy: retry ${g.policy.retryBudget}, parallel ${g.policy.maxParallel}, ping ${g.policy.ping}`,
    ...g.nodes.map(row),
    g.gates.length ? `gates: ${g.gates.map(x => `${x.id} ${x.kind}${x.reachedAt ? ' (reached)' : ''}`).join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

/** Auto mode chosen for a mission: plan with the Workbench, hand each phase to the runner. The format sheet is inline so
 *  the orchestrator edits a brief instead of studying the skill (the comparison measured ~6 min and +20k context for that). */
const autoModeRules = (wb: string) => `

AUTO MODE (the owner's choice): you plan, the substrate runs. Do not dispatch builders yourself.
1. Starting brief: see "STARTING BRIEF" below. Edit it in place (a version-2 Workbench brief); keep the owner's words in goal.
2. Check it: PYTHONPATH="${wb}" python3 -m workbench preflight ops/brief.json (--json for machine output). Fix every
   BLOCK (each finding names its fix) until it prints READY, then commit the brief.
3. Run it: mcp__orc__run_graph {brief: "ops/brief.json"} and end your turn. You are pinged ("[orc graph]") when a node
   exhausts its retries, a gate is reached, or the graph is done. Answer with mcp__orc__graph_decide; look with
   mcp__orc__graph_status; never mark graph children yourself. Gates: request the verification the ping names.
4. A later phase or the amendment gets its own brief (ops/brief-2.json), same steps.
5. Integration (replaces the rule above for graph runs): merges are not integration-checked until your integrator node
   passes, unless a check from an earlier phase is committed. Give that node the path ops/integration/ and it writes
   ops/integration/check.sh itself; otherwise the substrate's integrator writes it right after that node merges. The
   substrate then runs it after every later merge.
BRIEF FORMAT (what preflight needs):
- workbench_brief 2; goal; phase {name, objective}; later_phases [{name, goal, requires[]}]; criteria [{id, text}]
- decisions [{id, question, choice, reversibility hard|easy, status decided|open}]: record the hard-to-change ones
  (formats, interfaces, storage, permissions); a hard one may not stay open
- policy {retry_budget_per_node, max_parallel, ping failures_only|phase_end|every_node, caps {max_agents,
  max_retries_per_node, max_minutes}, allowed_effects[], verify}. verify {"code": "gates_only"} merges code nodes on
  their own check and lets the covering gate's verifier check them (about 2x faster than a verifier per node at equal
  quality; use it when a node's check really exercises its criteria); "per_node" gives each node its own verifier
  first (keep it for frontend, research and docs, and for thin checks)
- nodes [{id, role builder|integrator, work_type code|frontend|research|docs, objective, inputs[], outputs[], paths[]
  (what it may write; nodes that can run in parallel must not overlap), depends_on[] (include whoever outputs your
  inputs), check (runnable shell commands, one per line; a test file must be someone's output or exist), verifier (not
  the builder), effects[], tools[], credentials[{name, kind env|file}], criteria[], estimate_minutes, verify?}]
- gates [{id, kind checkpoint|final, after[], check, verifier}]: one final gate after an integrator node that depends on
  every builder; its check tests the combined result end to end, not a node's check
- time cap: critical-path minutes x (1 + retry_budget_per_node) <= caps.max_minutes
Reference only if stuck: ${wb}/skill/SKILL.md and ${wb}/skill/examples/v2/.`

/** Write the starting brief for an auto-mode mission: from the approved orc plan when there is one (Workbench
 *  import-orc --version 2, then preflight), else a skeleton. Returns the STARTING BRIEF section of the prompt. */
async function prepareStartingBrief($: EngineInterface, repo: string, fromPlan: boolean): Promise<string> {
  const dir = workbenchDir()
  const out = `${repo}/ops/brief.json`
  const wb = (args: string) => $.process.run(['/bin/sh', '-c', `PYTHONPATH="${dir}" python3 -m workbench ${args}`], { cwd: repo, timeoutMs: 60000 })
  try {
    await $.process.run(['mkdir', '-p', `${repo}/ops`], { timeoutMs: 10000 })
    if (!(await $.fs.exists(`${dir}/workbench/__main__.py`))) return `\n\nSTARTING BRIEF: the Workbench is not installed at ${dir}; write ops/brief.json from the format above.`
    if (fromPlan && (await $.fs.exists(`${missionDir(repo)}/state.json`))) {
      const imp = await wb(`import-orc "${missionDir(repo)}/state.json" -o "${out}" --version 2`)
      if (imp.exitCode === 0) {
        const pf = await wb(`preflight "${out}"`)
        const tail = `${pf.stdout}\n${pf.stderr}`.trim().split('\n').slice(-14).join('\n')
        return `\n\nSTARTING BRIEF: ops/brief.json was generated from the plan the owner approved (nodes, checks, an integrator, a final gate, gates_only code, the approved constraints as decided decisions). Preflight now says:\n${tail}\nFix what it reports (keep the approved plan's shape), commit, and run it.`
      }
    }
    if (!(await $.fs.exists(out))) await wb(`new "${out}" --type code`)
    return `\n\nSTARTING BRIEF: ops/brief.json is a skeleton with one empty code node. Fill it from the mission using the format above.`
  } catch (err) {
    return `\n\nSTARTING BRIEF: could not prepare one (${short(String(err), 100)}); write ops/brief.json from the format above.`
  }
}

/** Lab start in main mode (from /orc demo or /orc start mode=main): the owner typed the command, the mission file is
 *  theirs, so no intake gates; everything else is the owner-approved main mode. */
async function startMainLab($: EngineInterface, a: { mission: string; repo: string; amendment?: string; finalPath: string; compactAt?: number; maxAgents?: number; archived: string; auto?: boolean }): Promise<string> {
  const at = await $.clock.now()
  const rules = mainRules(a.mission, a.repo, a.amendment, a.finalPath) + (a.auto ? autoModeRules(workbenchDir()) + (await prepareStartingBrief($, a.repo, false)) : '')
  const rulesPath = `${OUT_DIR}/mission-${at}.rules.md`
  await $.fs.write(rulesPath, rules)
  const cap = a.maxAgents ?? 3
  const row: OrcAgent = { id: MAIN_ORCH, type: 'orc:orchestrator', description: `orchestrator (main session): ${a.mission.replace(/.*\//, '')}`, status: 'running', startedAt: at, toolCalls: 0, toolErrors: 0, promptChars: 0, steps: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, classes: {}, activities: {}, tools: [], outProseChars: 0, outThinkChars: 0, outArgChars: 0, ctxTokens: 0, ctxMax: 0, ctxFirst: 0, children: 0, runs: 1 }
  await update($, agents, map => ({ ...(map ?? {}), [MAIN_ORCH]: row }))
  try { await $.process.run(['mkdir', '-p', missionDir(a.repo)], { timeoutMs: 10000 }) } catch { /* best effort */ }
  const acct = await promptAccounting($)
  const m0: OrcMission = { repo: a.repo, dir: missionDir(a.repo), version: 1, status: 'running', mode: 'main', findings: [], decisions: [], startedAt: at, missionFile: a.mission, rulesPath, lab: { compactAt: a.compactAt, maxCompactions: 2, maxAgents: cap, auto: a.auto }, compactions: [], updatedAt: at }
  const m: OrcMission = { ...m0, brief: { chars: orchestratorBrief(m0).length, renders: [], spBefore: acct.sp, window: acct.window, windowSource: acct.windowSource } }
  await update($, missionState, () => m)
  await persistMission($, m)
  await note($, { kind: 'spawn', agentId: MAIN_ORCH, text: `main session is the orchestrator (lab): ${a.mission.replace(/.*\//, '')}${a.compactAt ? ` · forced compaction at ≥ ${k(a.compactAt)}` : ''}` })
  await inboxPush($, { kind: 'notice', text: `orc mission (automatic): the owner started this mission with /orc. ${rules}\n\nMain-session specifics: ${mainSpecifics(cap)}` })
  return `orc start: the main session is now the orchestrator for ${a.repo} (mission ${a.mission}${a.amendment ? `, amendment ${a.amendment}` : ''}, rules ${rulesPath}${a.compactAt ? `; lab: the substrate compacts this session once its context reaches ${k(a.compactAt)}, at a moment with work in flight` : ''}).${a.archived} Its working rules arrive as the next prompt.`
}

/** Packet 3: the mission's durable state in the repository. The snapshot is a projection of the ledger (children,
 *  marks, merges, verifications, integration runs) written by the substrate, so a new session can resume from the
 *  repo alone. */
async function syncMissionState($: EngineInterface) {
  const m = await read($, missionState)
  if (!m || m.status !== 'running' || m.mode === 'subagent') return
  const map = (await read($, agents)) ?? {}
  const orch = map[MAIN_ORCH]
  if (!orch) return
  const kids = kidsOf(map, orch).sort((a, b) => a.startedAt - b.startedAt)
  const snap: NonNullable<OrcMission['snapshot']> = {
    at: await $.clock.now(),
    cursor: orch.cursor ?? 0,
    children: kids.map(c => ({ id: c.id, type: c.type, description: c.description, status: c.status, startedAt: c.startedAt, endedAt: c.endedAt, mark: c.mark ? `${c.mark.verdict}: ${short(c.mark.note, 80)}` : undefined, merged: c.worktree?.merged, branch: c.worktree?.branch, reportPath: c.reportPath, check: c.checkResult?.status })),
    verifyRequests: (orch.verifyRequests ?? []).map(v => ({ id: v.id, stage: v.stage, at: v.at })),
    integrationRuns: (orch.integration?.runs ?? []).map(r => ({ at: r.at, after: r.after, status: r.status, load: r.load })),
  }
  const prev = JSON.stringify(m.snapshot?.children ?? []) + (m.snapshot?.verifyRequests.length ?? 0) + (m.snapshot?.integrationRuns.length ?? 0)
  const now = JSON.stringify(snap.children) + snap.verifyRequests.length + snap.integrationRuns.length
  if (prev === now) return
  const next: OrcMission = { ...m, snapshot: snap, updatedAt: snap.at }
  await update($, missionState, () => next)
  await persistMission($, next)
}

/** Resume a mission from <repo>/ops/orc/state.json in this session (packet 3). The successor adopts the snapshot's
 *  children so marks and status keep working, then gets the working rules plus a delta of what is pending. */
async function resumeMission($: EngineInterface, repoGiven?: string): Promise<string> {
  const repo = await repoOf($, repoGiven)
  const path = `${missionDir(repo)}/state.json`
  if (!(await $.fs.exists(path))) return `orc resume: no mission state at ${path}. Start one with /orc begin <request>.`
  let m: OrcMission
  try { m = JSON.parse(await $.fs.read(path)) as OrcMission } catch (err) { return `orc resume: ${path} is not readable JSON (${short(String(err), 100)})` }
  m = { ...m, repo, dir: missionDir(repo) }
  const at = await $.clock.now()
  await update($, missionState, () => m)
  const u = m.understanding
  const head = `orc resume: mission v${m.version} for ${repo} · status ${m.status} · ${u ? short(u.mission.statement, 90) : '(no package)'}`
  const directives = (m.directives ?? []).slice(-5).map(d => `- ${iso(d.at)} ${d.text}`).join('\n')
  if (m.status === 'done') {
    const bl = (m.backlog ?? []).filter(b => b.status === 'queued')
    return `${head}\nThis mission is finished (${m.snapshot ? `${m.snapshot.children.length} children, ${m.snapshot.children.filter(c => c.merged === 'merged').length} merges` : 'no snapshot'}). Final report: ${repo}/ops/FINAL.md. Continue it under orc with /orc continue <request> (same rules, no new gates).${bl.length ? `\nBacklog has ${bl.length} queued item(s); start the next with /orc backlog next.` : '\nBacklog is empty; add the next request with /orc backlog add <request> or start a new intake with /orc begin <request>.'}${directives ? `\nStanding directives:\n${directives}` : ''}`
  }
  if (m.status !== 'running') {
    openPane($)
    const gate = m.status === 'understanding_requested' ? 'gate 1 (is this what you mean?) awaits the owner in the pane' : m.status === 'permission_requested' ? 'gate 2 (plan & rules) awaits the owner in the pane' : m.status === 'understood' ? 'gate 1 passed; the plan and rules are being drafted (stage 2)' : 'drafting (stage 1)'
    return `${head}\nIntake restored: ${gate}. Findings: ${m.findings.length ? m.findings.join(' | ') : 'none'}. Read mcp__orc__owner_context and continue from there.${directives ? `\nStanding directives:\n${directives}` : ''}`
  }
  if (m.mode === 'subagent') return `${head}\nThis mission is orchestrated by a subagent; resume it with /orc start ${m.missionFile ?? `${m.dir}/MISSION.md`} fresh=1 (a successor orchestrator adopts its children).`
  // running, main mode: rebuild the main row and adopt the snapshot's children
  const map = (await read($, agents)) ?? {}
  const snap = m.snapshot
  const existing = map[MAIN_ORCH]
  const row: OrcAgent = existing && (existing.status === 'running' || existing.status === 'pending') ? existing : { id: MAIN_ORCH, type: 'orc:orchestrator', description: `orchestrator (main session, resumed): ${short(u?.mission.statement ?? '', 60)}`, status: 'running', startedAt: m.startedAt ?? at, toolCalls: 0, toolErrors: 0, promptChars: 0, steps: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, classes: {}, activities: {}, tools: [], outProseChars: 0, outThinkChars: 0, outArgChars: 0, ctxTokens: 0, ctxMax: 0, ctxFirst: 0, children: 0, runs: (existing?.runs ?? 0) + 1, cursor: snap?.cursor, verifyRequests: snap?.verifyRequests.map(v => ({ ...v, repo })), integration: snap ? { repo, runs: snap.integrationRuns.map(r => ({ at: r.at, after: r.after, status: r.status, exitCode: r.status === 'pass' ? 0 : 1, ms: 0, tail: '(from snapshot)', reported: true, load: r.load })), dispatches: [] } : undefined }
  let adopted = 0
  const additions: Record<string, OrcAgent> = { [MAIN_ORCH]: row }
  for (const c of snap?.children ?? []) {
    if (map[c.id]) continue
    adopted += 1
    additions[c.id] = { id: c.id, type: c.type, description: c.description, status: c.status, startedAt: c.startedAt, endedAt: c.endedAt, toolCalls: 0, toolErrors: 0, promptChars: 0, steps: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, parentId: MAIN_ORCH, classes: {}, activities: {}, tools: [], outProseChars: 0, outThinkChars: 0, outArgChars: 0, ctxTokens: 0, ctxMax: 0, ctxFirst: 0, children: 0, runs: 1, reportPath: c.reportPath, mark: c.mark ? { verdict: c.mark.split(':')[0] as 'accepted' | 'rejected' | 'redo', note: c.mark.slice(c.mark.indexOf(':') + 2), at: c.endedAt ?? c.startedAt } : undefined, worktree: c.branch ? { path: '', branch: c.branch, base: repo, merged: c.merged as 'merged' | 'conflict' | 'nothing' | 'error' | undefined, pruned: true } : undefined }
  }
  await update($, agents, mp => ({ ...(mp ?? {}), ...additions }))
  const kids = Object.values({ ...map, ...additions }).filter(a => a.parentId === MAIN_ORCH)
  const unmarked = kids.filter(a => a.status !== 'running' && a.status !== 'pending' && !a.mark)
  const merged = kids.filter(a => a.worktree?.merged === 'merged')
  const lastVer = (snap?.verifyRequests ?? []).slice(-1)[0]
  const delta = [
    `[orc resume] mission v${m.version} resumed in this session at ${iso(at)} (snapshot ${snap ? iso(snap.at) : 'none'}; ${adopted} children adopted from the repository state).`,
    `done: ${merged.length} merged (${merged.map(a => short(a.description, 24)).join('; ') || 'none'})`,
    `unmarked returns: ${unmarked.length ? unmarked.map(a => `${a.id.slice(0, 7)} "${short(a.description, 30)}"${a.reportPath ? ` report ${a.reportPath}` : ''}`).join('; ') : 'none'}`,
    `last verification requested: ${lastVer ? `${lastVer.stage} at ${iso(lastVer.at)}` : 'none'} · integration runs: ${(snap?.integrationRuns ?? []).map(r => r.status).join(', ') || 'none'}`,
    `owner decisions: ${m.decisions.map(d => `${d.gate === 'permission' ? 'plan&rules' : d.gate} ${d.choice}`).join(', ') || 'none'}${directives ? `\nstanding directives:\n${directives}` : ''}`,
    `Children that were still running when the previous session ended are NOT running now: re-dispatch what is missing. Read ${repo}/ops/DECISIONS.md and ${repo}/ops/orc/UNDERSTANDING.md, then continue the mission under the working rules below.`,
  ].join('\n')
  const rules = orchestratorPrompt(m.missionFile ?? `${m.dir}/MISSION.md`, repo, undefined, `${repo}/ops/FINAL.md`)
    .replace(/^You are the orchestrator for the mission in (.+?)\. Read it first, whole\./, 'YOU, the main session, are the orchestrator for the mission in $1 (resumed). Read it first, whole.')
  const next: OrcMission = { ...m, updatedAt: at }
  await update($, missionState, () => next)
  await persistMission($, next)
  await note($, { kind: 'spawn', agentId: MAIN_ORCH, text: `mission v${m.version} resumed; ${adopted} children adopted` })
  await inboxPush($, { kind: 'notice', text: `orc mission (automatic, resumed): ${delta}\n\n${rules}\n\nMain-session specifics: dispatch builders yourself (orc:builder, run_in_background true, CHECK:/CHECK_CWD:/MAY_CHANGE: lines); act on "[orc wake]" prompts; spawn verifiers/integrator only when a tool result or an "[orc inbox]" item says SPAWN NOW (once each); owner limit ${u?.executionPolicy.maxAgents ?? 3} builders at a time; end your turn between wakes.` })
  return `${head}\nResumed as the orchestrator in this session: ${adopted} children adopted, ${merged.length} merged, ${unmarked.length} unmarked. The working rules and the delta arrive as the next prompt.`
}

async function addDirective($: EngineInterface, text: string): Promise<string> {
  const m = await read($, missionState)
  if (!m) return 'orc directive: no mission in this session (resume or begin one first).'
  const at = await $.clock.now()
  const next: OrcMission = { ...m, directives: [...(m.directives ?? []), { at, text: text.trim() }], updatedAt: at }
  await update($, missionState, () => next)
  await persistMission($, next)
  await note($, { kind: 'note', agentId: 'owner', text: `directive: ${short(text, 60)}` })
  return `orc: directive recorded (${(next.directives ?? []).length} standing): "${short(text, 100)}". It is in ${next.dir}/state.json and UNDERSTANDING.md and is read on resume.`
}

async function backlogOp($: EngineInterface, action: 'list' | 'add' | 'next', request?: string): Promise<string> {
  const m = await read($, missionState)
  if (!m) return 'orc backlog: no mission in this session (resume or begin one first); the backlog lives with the mission\'s repository.'
  const at = await $.clock.now()
  const list = m.backlog ?? []
  if (action === 'list') return list.length ? `orc backlog (${m.repo}):\n${list.map(b => `- [${b.status}] ${b.id}: ${short(b.request, 100)}`).join('\n')}` : `orc backlog (${m.repo}): empty. Add with /orc backlog add <request>.`
  if (action === 'add') {
    if (!request?.trim()) return 'orc backlog add: say what to queue.'
    const id = `b${list.length + 1}`
    const next: OrcMission = { ...m, backlog: [...list, { id, request: request.trim(), at, status: 'queued' }], updatedAt: at }
    await update($, missionState, () => next); await persistMission($, next)
    return `orc backlog: queued ${id}: "${short(request, 100)}" (${next.backlog!.length} items).`
  }
  const nextItem = list.find(b => b.status === 'queued')
  if (!nextItem) return 'orc backlog next: nothing queued.'
  if (m.status !== 'done') return `orc backlog next: the current mission is ${m.status}; finish or settle it first.`
  const seed: OrcUnderstanding = { mission: { statement: '', deliverables: [] }, finalPicture: { summary: '', criteria: [], constraints: [], exclusions: [] }, plan: { nodes: [] }, team: { roles: [] }, executionPolicy: { model: 'inherit', maxAgents: 3, maxAttemptsPerNode: 2, maxDurationMinutes: 120, allowedEffects: ['local_read', 'local_write'], materialChangeRule: '' }, executionTarget: { kind: 'git_repository', repositoryPath: m.repo, allowedPaths: [] }, sourceEvidence: { originalRequest: nextItem.request, items: [{ id: 'e1', text: nextItem.request, classification: 'supplied', role: 'context', source: `owner, backlog ${nextItem.id}` }], coverage: [] }, openQuestions: [] }
  const next: OrcMission = { ...m, version: m.version + 1, status: 'drafting', understanding: seed, findings: ['(seed only: interview, then draft)'], decisions: [], snapshot: undefined, startedAt: undefined, missionFile: undefined, backlog: list.map(b => b.id === nextItem.id ? { ...b, status: 'started' } : b), updatedAt: at }
  await update($, missionState, () => next); await persistMission($, next)
  return `orc backlog: started ${nextItem.id} as mission v${next.version} (intake, stage 1). Original request recorded.\n\n${await ownerContext($, m.repo)}\n\nInterview the owner now (restate, then one question at a time with options).`
}

/** A previous run's ops files go to ops/history/<stamp>/ (committed), and its clones are removed. */
async function archivePreviousRun($: EngineInterface, repo: string) {
  const isRepo = (await $.process.run(['git', '-C', repo, 'rev-parse', 'HEAD'], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1 }))).exitCode === 0
  if (isRepo && (await $.fs.exists(`${repo}/ops/DECISIONS.md`))) {
    const d = new Date(await $.clock.now())
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    const cmd = `cd "${repo}" && mkdir -p ops/history/${stamp} && for f in DECISIONS.md CONTRACTS.md CHECKPOINT-1.md FINAL.md SCORE.md work-orders; do [ -e "ops/$f" ] && git mv -k "ops/$f" "ops/history/${stamp}/" 2>/dev/null || { [ -e "ops/$f" ] && mv "ops/$f" "ops/history/${stamp}/"; }; done; git add ops/history ops/DECISIONS.md ops/CONTRACTS.md ops/CHECKPOINT-1.md ops/FINAL.md ops/SCORE.md ops/work-orders 2>/dev/null; git commit -q -m "orc: archive previous run to ops/history/${stamp}" 2>/dev/null; true`
    await $.process.run(['/bin/sh', '-c', cmd], { timeoutMs: 60000 })
    try { await $.process.run(['/bin/sh', '-c', `rm -rf "${repo}-wt" && git -C "${repo}" worktree prune`], { timeoutMs: 30000 }) } catch { /* best effort */ }
  }
}

/** The orc computer at launch: when gate 2 granted workers a browser, orc proves that browser now (a local page at 375 px),
 *  so a broken browser surfaces while the owner is here. Returns the note for the orchestrator (empty when no browser was granted). */
async function computerLaunchNote($: EngineInterface, m: OrcMission): Promise<string> {
  const webRoles = ['builder', 'verifier'].filter(r => browserGranted(m, r))
  let computer = ''
  if (webRoles.length) {
    const server = browserServer()
    if (!server) computer = `\n\nORC COMPUTER: gate 2 granted a browser to ${webRoles.join(' and ')}s, but no browser is configured for orc (config "browser"). Tell the owner before dispatching; checks that need it cannot run.`
    else {
      let res: { ok?: boolean; tools?: number; width?: number | null; error?: string } = {}
      try {
        const r = await $.process.run(['node', `${PLUGIN_ROOT}/bin/browser-check.mjs`, JSON.stringify(server)], { timeoutMs: 180000 })
        res = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}')
      } catch (err) { res = { ok: false, error: String(err) } }
      await note($, { kind: 'note', text: `orc computer browser check: ${res.ok ? `ok (${res.tools} tools, ${res.width}px)` : `FAILED: ${short(res.error ?? '', 80)}`}` })
      computer = res.ok
        ? `\n\nORC COMPUTER: orc started the mission browser and opened a local page at ${res.width}px: it works. ${webRoles.map(r => `${r === 'builder' ? 'Builders' : 'Verifiers'} that need it run as orc:${r}-web`).join('; ')} (verifiers are dispatched that way for you; dispatch a builder whose step needs the browser as orc:builder-web, the others as orc:builder). It opens local pages only; you need not try it yourself.`
        : `\n\nORC COMPUTER: the mission browser did NOT start: ${short(res.error ?? '', 200)}. Tell the owner now, before dispatching; checks that need it cannot run.`
    }
  }
  return computer
}

/** Continue a finished mission with the owner's next request: no new interview or gate. The approved understanding,
 *  plan, rules and standing directives carry into version+1; the request is the amendment and the approval; the previous
 *  run's ops files go to ops/history/; the main session is the orchestrator again with the whole substrate. (Emeka's
 *  NCLEX run, 2026-10-08: Phase 1 settled the mission and Phases 2–7 ran by hand: no clones, checks, gates or pane,
 *  48 raw notification turns, two commit sweeps.) */
async function continueMission($: EngineInterface, request: string): Promise<string> {
  const m = await read($, missionState)
  const refusal = continueRefusal(m, request)
  if (refusal || !m) return refusal ?? 'orc continue: no mission.'
  const u = m.understanding
  const at = await $.clock.now()
  const finalPath = `${m.repo}/ops/FINAL.md`
  let previousFinal: string | undefined
  try { previousFinal = /^STATUS:.*$/m.exec(await $.fs.read(finalPath))?.[0] } catch { /* no final report */ }
  await archivePreviousRun($, m.repo)
  const dir = missionDir(m.repo)
  const version = m.version + 1
  const req = request.trim()
  const missionPath = `${dir}/MISSION.md`
  const base: OrcMission = { ...m, version, status: 'running', mode: 'main', startedAt: at, missionFile: missionPath, snapshot: undefined, editUnlocked: undefined, brief: undefined, graph: undefined, rulesPath: undefined,
    decisions: [...m.decisions, { at, gate: 'continue', choice: 'approve', note: short(req, 200) }],
    continuations: [...(m.continuations ?? []), { at, version, request: req, previousFinal }], updatedAt: at }
  // The mission text: regenerated from the approved understanding (the interview path), or the mission file the owner
  // started with (/orc start), copied so the owner's own file is never edited.
  let missionText = ''
  if (u) missionText = missionFileFrom(base)
  else { try { missionText = await $.fs.read(m.missionFile ?? missionPath) } catch { missionText = `# Mission (continued)\nRepository: ${m.repo}\n` } }
  const marker = '\n## Continuation (v'
  if (missionText.includes(marker)) missionText = missionText.slice(0, missionText.indexOf(marker)) + '\n'
  await $.fs.write(missionPath, missionText.replace(/\n*$/, '\n') + `\n## Continuation (v${version}, ${iso(at)})\nThe owner continued the finished mission (previous final: ${previousFinal ?? 'none'}) with this request, which is the amendment and the approval:\n\n${req}\n`)
  const row: OrcAgent = { id: MAIN_ORCH, type: 'orc:orchestrator', description: `orchestrator (main session, continued v${version}): ${short(req, 60)}`, status: 'running', startedAt: at, toolCalls: 0, toolErrors: 0, promptChars: 0, steps: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, classes: {}, activities: {}, tools: [], outProseChars: 0, outThinkChars: 0, outArgChars: 0, ctxTokens: 0, ctxMax: 0, ctxFirst: 0, children: 0, runs: 1 }
  await update($, agents, map => ({ ...(map ?? {}), [MAIN_ORCH]: row }))
  await update($, missionState, () => base)
  await persistMission($, base)
  await note($, { kind: 'spawn', agentId: MAIN_ORCH, text: `mission continued as v${version}: ${short(req, 50)}` })
  const auto = u?.executionPolicy?.mode === 'auto' || m.lab?.auto === true
  const cap = m.lab?.maxAgents ?? u?.executionPolicy?.maxAgents ?? 3
  const rules = mainRules(missionPath, m.repo, req, finalPath) + (auto ? autoModeRules(workbenchDir()) : '')
  const rulesPath = `${OUT_DIR}/mission-${at}.rules.md`
  try { await $.fs.write(rulesPath, rules) } catch { /* best effort */ }
  const acct = await promptAccounting($)
  const withRules: OrcMission = { ...base, rulesPath, brief: { chars: orchestratorBrief({ ...base, rulesPath }).length, renders: [], spBefore: acct.sp, window: acct.window, windowSource: acct.windowSource } }
  await update($, missionState, () => withRules)
  await persistMission($, withRules)
  const computer = await computerLaunchNote($, withRules)
  const prev = m.snapshot ? `${m.snapshot.children.length} children, ${m.snapshot.children.filter(c => c.merged === 'merged').length} merged` : 'no snapshot'
  const delta = [
    `[orc continue] mission v${m.version} was finished (${previousFinal ?? 'no FINAL status'}; ${prev}); its ops files are now in ops/history/. The owner continues it as v${version} with this request, recorded as the amendment and the approval (no new interview, no new gate):`,
    `"${req}"`,
    `${u ? `The approved understanding, plan, rules and standing directives stand (${dir}/UNDERSTANDING.md; mission file ${missionPath})` : `The mission the owner started with stands, with the continuation appended (mission file ${missionPath})`}. Plan the continuation from the request and the approved plan: work orders keep the plan's node ids where they apply and take new ones for new steps; every builder goes through the substrate (clones, checks, boundaries, marks, merges); request a checkpoint verifier at the end of each phase; write ${finalPath} (STATUS: PASS or FAIL, never PENDING) only when the request is complete. The mission settles again then, and the owner can continue it again.`,
    auto ? 'The previous graph is finished: write a new Workbench brief for the continuation and hand it to mcp__orc__run_graph.' : '',
  ].filter(Boolean).join('\n')
  await inboxPush($, { kind: 'notice', text: `orc mission (automatic, continued): ${delta}${computer}\n\n${rules}\n\nMain-session specifics: ${mainSpecifics(cap)}` })
  return `orc continue: mission v${m.version} → v${version} for ${m.repo}. The main session is the orchestrator again under the approved rules; clones, checks, verifiers, merges and the pane are back. The owner's request and the working rules arrive as the next prompt.`
}

/** A running mission settles to done once its final report is committed with a non-PENDING status and no orc agent is live. */
async function settleMission($: EngineInterface) {
  const m = await read($, missionState)
  if (!m || m.status !== 'running') return
  const finalPath = `${m.repo}/ops/FINAL.md`
  if (!(await $.fs.exists(finalPath))) return
  const status = /^STATUS:.*$/m.exec(await $.fs.read(finalPath))?.[0] ?? ''
  if (!status || /PENDING/i.test(status)) return
  const map = (await read($, agents)) ?? {}
  // The main row itself is 'running' until settled: it must not block the settle.
  if (Object.values(map).some(a => a.id !== MAIN_ORCH && a.type.startsWith('orc:') && a.startedAt >= (m.startedAt ?? 0) && (a.status === 'running' || a.status === 'pending'))) return
  // Final snapshot before the status flips (the sync only runs while the mission is running).
  try { await syncMissionState($) } catch { /* best effort */ }
  const m2 = (await read($, missionState)) ?? m
  const at = await $.clock.now()
  const next: OrcMission = { ...m2, status: 'done', editUnlocked: undefined, updatedAt: at }
  await update($, missionState, () => next)
  await persistMission($, next)
  if (map[MAIN_ORCH]) await patchAgent($, MAIN_ORCH, a => ({ ...a, status: 'completed', endedAt: at }))
  const started = (next.backlog ?? []).find(b => b.status === 'started')
  if (started) { const n2: OrcMission = { ...next, backlog: next.backlog!.map(b => b.id === started.id ? { ...b, status: 'done' } : b) }; await update($, missionState, () => n2); await persistMission($, n2) }
  await note($, { kind: 'note', agentId: 'owner', text: `mission v${m.version} done: ${short(status, 60)}` })
  $.ui.toast(`orc: mission v${m.version} done — ${short(status, 60)} · /orc continue <request> keeps going under orc`)
}

/** Process one due integration run (set by a merge): run the registered script if it exists, otherwise have the integrator write it. */
async function processIntegration($: EngineInterface) {
  const map = (await read($, agents)) ?? {}
  for (const orch of Object.values(map).filter(a => isIntegType(a.type) && a.integration?.due)) {
    const integ = orch.integration!
    const due = integ.due!
    await patchAgent($, orch.id, a => ({ ...a, integration: a.integration ? { ...a.integration, due: undefined } : a.integration }))
    const script = `${integ.repo}/ops/integration/check.sh`
    // Only a COMMITTED check runs (never the integrator's draft on disk, which ran half-edited twice in 2-r3).
    let committed = false
    try {
      const ls = await $.process.run(['git', 'ls-files', '--error-unmatch', 'ops/integration/check.sh'], { cwd: integ.repo, timeoutMs: 10000 })
      committed = ls.exitCode === 0
    } catch {
      committed = false
    }
    if (!committed || !(await $.fs.exists(script))) {
      const pend = orch.id === MAIN_ORCH ? graphIntegratorPending(await read($, missionState)) : undefined
      if (pend) {
        await note($, { kind: 'note', agentId: orch.id, text: `integration after ${short(due.after, 24)}: deferred until graph node ${pend.id} (integrator) passes` })
        continue
      }
      const sent = await dispatchIntegrator($, map, orch, integ.repo, `first merge (${due.after}): author the integration check`)
      // The integrator is still writing the check: keep this merge due until the script exists or the integrator returns
      // (its own registered check then stands for the merges that landed meanwhile).
      if (!sent) await patchAgent($, orch.id, a => ({ ...a, integration: a.integration ? { ...a.integration, due: a.integration.due ?? due } : a.integration }))
      continue
    }
    const now0 = await $.clock.now()
    const ml = await machineLoad($)
    const res = await runScript($, 'bash ops/integration/check.sh', integ.repo)
    const run = { at: now0, after: due.after, status: res.status, exitCode: res.exitCode, ms: res.ms, tail: res.tail, reported: false, redispatched: false, load: ml?.load, cores: ml?.cores }
    await note($, { kind: 'note', agentId: orch.id, text: `integration after ${short(due.after, 24)}: ${run.status} (${clock(run.ms)})` })
    try { await $.fs.write(`${OUT_DIR}/ledger/${orch.id.slice(0, 7)}.md`, fullLedger((await read($, agents)) ?? {}, orch.id, now0)) } catch { /* best effort */ }
    const map2 = (await read($, agents)) ?? {}
    // FAIL-repeat rule: a FAIL whose failing steps are all in the previous run's failing steps carries no new
    // information (a known pending item, e.g. a README not yet merged); it still wakes the orchestrator but does
    // not re-dispatch the integrator.
    const failSet = (tail: string) => new Set(tail.split('\n').filter(l => /^\s*FAIL\b/.test(l)).map(l => l.trim().split(/\s+/).slice(0, 2).join(' ')))
    const prev = integ.runs.length ? integ.runs[integ.runs.length - 1]! : undefined
    const nowFails = failSet(run.tail)
    const totalSteps = (tail: string) => tail.split('\n').filter(l => /^\s*(PASS|FAIL)\b/.test(l)).length
    // A previous run that failed every step, or died in under 5 s, was a broken script, not a baseline.
    const brokenScript = (tail: string) => /command not found|syntax error|unexpected token|No such file or directory: .*ops\/integration/.test(tail)
    const prevUsable = !!prev && prev.status !== 'pass' && !brokenScript(prev.tail)
    const repeat = prevUsable && nowFails.size > 0 && [...nowFails].every(f => failSet(prev!.tail).has(f))
    if (run.status !== 'pass' && !repeat) await dispatchIntegrator($, map2, map2[orch.id] ?? orch, integ.repo, `integration check ${run.status.toUpperCase()} after merge of ${due.after}${run.exitCode !== null ? ` (exit ${run.exitCode})` : ''}: diagnose, name the merge that broke it, fix the check only if the check is wrong`)
    if (run.status !== 'pass' && repeat) await note($, { kind: 'note', agentId: orch.id, text: `integration FAIL repeats the previous run's failing steps; no re-dispatch` })
    run.redispatched = run.status !== 'pass' && !repeat
    await patchAgent($, orch.id, a => ({ ...a, integration: a.integration ? { ...a.integration, runs: [...a.integration.runs, run].slice(-40) } : a.integration }))
    // Wake on actionable only (r11): a PASS is a state change but nothing to act on, so it stays unreported and
    // rides in the CHANGED section of the next wake; a FAIL or an unavailable check wakes the orchestrator now.
    // But a PASS with nothing else in flight is the only news that can come, so it wakes (v0.15.0 permission test: the
    // orchestrator waited 24 minutes for a held PASS after its last merge).
    if (run.status === 'pass') {
      const mapP = (await read($, agents)) ?? {}
      const inFlight = kidsOf(mapP, mapP[orch.id] ?? orch).some(k => k.status === 'running' || k.status === 'pending')
        || ((await read($, inboxState)) ?? []).some(i => !i.ackedAt && !!i.spawn)
        || (orch.id === MAIN_ORCH && ['running', 'waiting'].includes(graphOf(await read($, missionState))?.status ?? ''))
      if (inFlight) continue
      await note($, { kind: 'note', agentId: orch.id, text: 'integration PASS with nothing else in flight: waking the orchestrator' })
    }
    // While a graph runs, a FAIL that repeats the previous run's failing steps is work still in flight: it rides the
    // next wake too (v0.14.0 amendment phase: a wake per merge, each answered "nothing new").
    if (repeat && orch.id === MAIN_ORCH) {
      const gs = graphOf(await read($, missionState))?.status
      if (gs === 'running' || gs === 'waiting') continue
    }
    const map3 = (await read($, agents)) ?? {}
    const now = await $.clock.now()
    const text = ledgerWake(map3, orch.id, undefined, now, '')
    const live = await $.agent.list()
    const st = live.find(x => x.id === orch.id)?.status
    if (orch.id === MAIN_ORCH) {
      await markReported($, map3, orch.id, now)
      await notifyOrch($, MAIN_ORCH, text)
    } else if (st === 'running' || st === 'pending') {
      // Queued wakes are flushed by the orchestrator's own turn end (a direct delivery): mark the runs reported.
      await markReported($, map3, orch.id, now)
      await patchAgent($, orch.id, a => ({ ...a, pendingWakes: [...(a.pendingWakes ?? []), { text, childId: 'integration', at: now }].slice(-20) }))
      await note($, { kind: 'send', agentId: orch.id, text: 'integration wake queued (orchestrator busy)' })
    } else {
      // A main-loop relay can arrive late or not at all: leave the runs unreported so the next direct wake carries
      // them again (a repeat costs a line; a loss costs a result).
      await relayViaMain($, 'send', { to: orch.id, text })
    }
  }
}

/** After a wake is built: integration runs it carried are now reported, and the full projection is written for context-loss pickup. */
async function markReported($: EngineInterface, map: Record<string, OrcAgent>, orchId: string, now: number) {
  await patchAgent($, orchId, a => ({ ...a, integration: a.integration ? { ...a.integration, runs: a.integration.runs.map(r => ({ ...r, reported: true })) } : a.integration }))
  try {
    await $.fs.write(`${OUT_DIR}/ledger/${orchId.slice(0, 7)}.md`, fullLedger(map, orchId, now))
  } catch (err) {
    $.ui.log(`orc: full ledger write failed: ${String(err)}`, { to: 'debug' })
  }
}

async function makeClone($: EngineInterface, base: string, description: string): Promise<{ path: string; branch: string } | undefined> {
  try {
    const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'builder'
    const stamp = (await $.clock.now()).toString(36).slice(-5)
    const branch = `wt/${slug}-${stamp}`
    const path = `${base.replace(/\/+$/, '')}-wt/${slug}-${stamp}`
    const ran = await $.process.run(['git', '-C', base, 'worktree', 'add', '-b', branch, path, 'HEAD'], { timeoutMs: 60000 })
    if (ran.exitCode !== 0) {
      $.ui.log(`orc: worktree add failed: ${short(ran.stderr, 160)}`)
      return undefined
    }
    return { path, branch }
  } catch (err) {
    $.ui.log(`orc: makeClone failed: ${String(err)}`)
    return undefined
  }
}

/** A detached, read-only-by-convention worktree at the repository's HEAD for a verifier, so merges and integrator
 *  commits that land while it works cannot move the tree under it. Pruned when the verifier is marked. */
async function makeSnapshot($: EngineInterface, repo: string, stage: string): Promise<{ path: string; sha: string; dirty: string } | undefined> {
  try {
    const head = await $.process.run(['git', '-C', repo, 'rev-parse', 'HEAD'], { timeoutMs: 10000 })
    if (head.exitCode !== 0) return undefined
    const sha = head.stdout.trim()
    const st = await $.process.run(['git', '-C', repo, 'status', '--porcelain'], { timeoutMs: 10000 })
    // orc's own state folder is not the work: its mission files are copied into the snapshot below.
    const dirtyFiles = st.stdout.split('\n').filter(Boolean).map(l => l.slice(3)).filter(f => !f.startsWith('ops/orc/') && f !== 'ops/orc')
    const dirty = dirtyFiles.length ? `${dirtyFiles.slice(0, 5).join(', ')}${dirtyFiles.length > 5 ? ` +${dirtyFiles.length - 5}` : ''}` : ''
    const root = `${repo.replace(/\/+$/, '')}-wt`
    const path = `${root}/verify-${stage}-${sha.slice(0, 7)}-${(await $.clock.now()).toString(36).slice(-5)}`
    const ran = await $.process.run(['git', '-C', repo, 'worktree', 'add', '--detach', path, sha], { timeoutMs: 60000 })
    if (ran.exitCode !== 0) {
      $.ui.log(`orc: snapshot worktree failed: ${short(ran.stderr, 160)}`)
      return undefined
    }
    // The verifier may read only the snapshot, so it gets the mission files orc keeps uncommitted (v0.15.1 clean run:
    // "MISSION.md is not in the snapshot and I was barred from the live repo").
    for (const f of ['ops/orc/MISSION.md', 'ops/orc/UNDERSTANDING.md']) {
      try {
        if ((await $.fs.exists(`${repo}/${f}`)) && !(await $.fs.exists(`${path}/${f}`))) {
          await $.process.run(['mkdir', '-p', `${path}/ops/orc`], { timeoutMs: 10000 })
          await $.fs.write(`${path}/${f}`, await $.fs.read(`${repo}/${f}`))
        }
      } catch { /* best effort: the brief still names the mission */ }
    }
    return { path, sha, dirty }
  } catch (err) {
    $.ui.log(`orc: makeSnapshot failed: ${String(err)}`)
    return undefined
  }
}

/** Switch 4: merge a builder's branch into the repository at acceptance. Never leaves a half-merge behind. */
async function mergeClone($: EngineInterface, wt: NonNullable<OrcAgent['worktree']>): Promise<{ merged: 'merged' | 'conflict' | 'nothing' | 'error'; note: string }> {
  try {
    const ahead = await $.process.run(['git', '-C', wt.base, 'rev-list', '--count', `HEAD..${wt.branch}`], { timeoutMs: 30000 })
    if (ahead.exitCode === 0 && ahead.stdout.trim() === '0') return { merged: 'nothing', note: `branch ${wt.branch} has no commits beyond the repository (the builder did not commit?)` }
    const m = await $.process.run(['git', '-C', wt.base, 'merge', '--no-ff', '--no-edit', '-m', `merge ${wt.branch} (accepted)`, wt.branch], { timeoutMs: 60000 })
    if (m.exitCode === 0) {
      const stat = await $.process.run(['git', '-C', wt.base, 'diff', '--stat', 'HEAD~1', 'HEAD'], { timeoutMs: 30000 })
      return { merged: 'merged', note: short(stat.stdout.trim().split('\n').slice(-1)[0] ?? '', 120) }
    }
    const conflicts = await $.process.run(['git', '-C', wt.base, 'diff', '--name-only', '--diff-filter=U'], { timeoutMs: 30000 })
    await $.process.run(['git', '-C', wt.base, 'merge', '--abort'], { timeoutMs: 30000 })
    return { merged: 'conflict', note: `CONFLICT in: ${conflicts.stdout.trim().split('\n').filter(Boolean).join(', ') || '(unknown)'}; merge aborted, repository unchanged, branch ${wt.branch} kept` }
  } catch (err) {
    try { await $.process.run(['git', '-C', wt.base, 'merge', '--abort'], { timeoutMs: 30000 }) } catch { /* ignore */ }
    return { merged: 'error', note: short(String(err), 160) }
  }
}

/** Pruning: remove a worktree directory once nobody works in it (a builder's clone after its mark, a verifier's
 *  snapshot after the verifier's mark). The branch is kept, so an accepted or rejected builder's commits stay
 *  reachable; only the checkout goes. Never touches the repository itself. */
async function pruneWorktree($: EngineInterface, base: string, path: string): Promise<string> {
  try {
    if (!path || path === base || !path.startsWith(`${base.replace(/\/+$/, '')}-wt/`)) return `kept (${path || 'no path'} is not under ${base}-wt)`
    if (!(await $.fs.exists(path))) return 'already gone'
    const ran = await $.process.run(['git', '-C', base, 'worktree', 'remove', '--force', path], { timeoutMs: 60000 })
    if (ran.exitCode !== 0) return `kept (git worktree remove failed: ${short(ran.stderr, 100)})`
    return 'removed'
  } catch (err) {
    return `kept (${short(String(err), 100)})`
  }
}

/** The 1-minute load average and the core count, so a timing result carries the machine state it was measured in. */
async function machineLoad($: EngineInterface): Promise<{ load: number; cores: number } | undefined> {
  try {
    const l = await $.process.run(['/bin/sh', '-c', '/usr/sbin/sysctl -n vm.loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg 2>/dev/null'], { timeoutMs: 5000 })
    const c = await $.process.run(['/bin/sh', '-c', '/usr/sbin/sysctl -n hw.ncpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null'], { timeoutMs: 5000 })
    const load = Number(/[\d.]+/.exec(l.stdout.replace(/[{}]/g, '').trim())?.[0])
    const cores = Number(/\d+/.exec(c.stdout)?.[0])
    if (!Number.isFinite(load) || !Number.isFinite(cores) || cores <= 0) return undefined
    return { load: Math.round(load * 10) / 10, cores }
  } catch {
    return undefined
  }
}

/** Deliver a wake to an orchestrator. A send to an agent that is mid-turn can be lost at its turn end, so when the
 *  parent is running the wake is queued on its row and flushed from its own turn.complete. */
async function deliverWake($: EngineInterface, parentId: string, childId: string, text: string) {
  if (parentId === MAIN_ORCH) { await notifyOrch($, MAIN_ORCH, text); return }
  const live = await $.agent.list()
  const p = live.find(x => x.id === parentId)
  const busy = p ? p.status === 'running' || p.status === 'pending' : false
  if (busy) {
    const at = await $.clock.now()
    await patchAgent($, parentId, a => ({ ...a, pendingWakes: [...(a.pendingWakes ?? []), { text, childId, at }].slice(-20) }))
    await note($, { kind: 'send', agentId: childId, text: `wake queued (parent busy) → ${parentId.slice(0, 7)}` })
    return
  }
  await $.session.send({ to: parentId, text })
}

/** THE MAIN-LOOP INBOX (lab: ops/DESIGN-MAIN-INBOX.md). Actions that originate in the plugin's own timer frame make the
 *  engine skip this plugin's hooks for what they cause (the spawned agent, the resumed turn), so the substrate never spawns
 *  or prompts directly. Everything the main session must KNOW (a wake for the main-session orchestrator) or DO (spawn a
 *  verifier, integrator or orchestrator; relay a wake to a subagent orchestrator) is an inbox item in session state, delivered
 *  through two doors — attached as context to the main session's next tool result while a main turn is open (a prompt
 *  submitted mid-turn is lost), submitted as one prompt once it is idle — acknowledged by evidence (the agent appeared; the
 *  prompt started a turn; the context was read in-turn) and redelivered every INBOX_REDELIVER_MS until then. Nothing is
 *  dropped silently; acknowledged items retire after an hour. */
const INBOX_REDELIVER_MS = 90000
const INBOX_RETIRE_MS = 3600000

function inboxLine(i: OrcInboxItem, now: number): string {
  const n = i.delivered.length
  const again = n > 1 ? ` [delivered ${n}×, first ${ago(i.delivered[0]!.at, now)}${i.kind === 'spawn' && n >= 3 ? ' — STILL NOT SPAWNED' : ''}]` : ''
  if (i.kind === 'spawn' && i.spawn) return `(${i.id}, spawn)${again} SPAWN NOW with the Agent tool: subagent_type "${i.spawn.type}", description "${i.spawn.description}", run_in_background true, prompt = the full contents of ${i.spawn.path} (read the file first). Spawn it once: if mcp__orc__status or the ledger already shows an agent with that description running, do not spawn another.`
  return `(${i.id}, ${i.kind})${again} ${i.text}`
}

function inboxBlock(items: OrcInboxItem[], now: number, midTurn: boolean): string {
  const head = midTurn
    ? `[orc inbox] ${items.length} item(s) arrived while you were working. Finish the current step, then act on each item in THIS turn as the working rules say, then continue:`
    : `[orc inbox] ${items.length} item(s) for the main session. Act on each as the working rules say, then end the turn:`
  return [head, ...items.map((i, n) => `${n + 1}. ${inboxLine(i, now)}`)].join('\n\n')
}

async function inboxPush($: EngineInterface, item: Pick<OrcInboxItem, 'kind' | 'text' | 'spawn'>): Promise<OrcInboxItem> {
  const at = await $.clock.now()
  const row: OrcInboxItem = { id: `ib-${at.toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind: item.kind, text: item.text, at, spawn: item.spawn, delivered: [] }
  await update($, inboxState, list => [...(list ?? []), row].slice(-60))
  await note($, { kind: 'send', agentId: MAIN_ORCH, text: `inbox ${row.id} (${row.kind}): ${short(row.spawn?.description ?? row.text, 50)}` })
  return row
}

async function inboxMarkDelivered($: EngineInterface, ids: string[], via: OrcInboxItem['delivered'][number]['via'], ackReadables = false) {
  const at = await $.clock.now()
  await update($, inboxState, list => (list ?? []).map(i => ids.includes(i.id) ? { ...i, delivered: [...i.delivered, { at, via }], ...(ackReadables && i.kind !== 'spawn' ? { ackedAt: at, ackedBy: via } : {}) } : i))
}

async function inboxAck($: EngineInterface, pred: (i: OrcInboxItem) => boolean, by: string) {
  const at = await $.clock.now()
  await update($, inboxState, list => (list ?? []).map(i => !i.ackedAt && pred(i) ? { ...i, ackedAt: at, ackedBy: by } : i))
}

/** Items that still need a delivery: never delivered, or delivered more than INBOX_REDELIVER_MS ago and not acknowledged. */
const inboxDue = (list: OrcInboxItem[], now: number) => list.filter(i => !i.ackedAt && (i.delivered.length === 0 || now - i.delivered[i.delivered.length - 1]!.at > INBOX_REDELIVER_MS))

/** The idle door: one prompt carrying every due item, only while no main turn is open. */
async function inboxDeliverIfIdle($: EngineInterface, why: string) {
  if (await read($, cur)) return
  const now = await $.clock.now()
  const due = inboxDue((await read($, inboxState)) ?? [], now)
  if (!due.length) return
  await inboxMarkDelivered($, due.map(i => i.id), 'prompt')
  if (due.some(i => i.delivered.length > 0)) $.ui.log(`orc: inbox re-delivered as a prompt (${why}): ${due.map(i => i.id).join(', ')}`)
  void $.prompt.submit({ text: `orc inbox (automatic) — ${inboxBlock(due, now, false)}` })
}

/** The busy door: every due item as context on the main session's next tool result (read for certain this turn). */
async function inboxContextFor($: EngineInterface): Promise<string | undefined> {
  const now = await $.clock.now()
  const due = inboxDue((await read($, inboxState)) ?? [], now)
  if (!due.length) return undefined
  await inboxMarkDelivered($, due.map(i => i.id), 'tool-context', true)
  return inboxBlock(due, now, true)
}

/** Sweep (30 s): acknowledge spawns whose agent appeared (also across a reload), redeliver when idle, retire old items. */
async function inboxSweep($: EngineInterface, map: Record<string, OrcAgent>, now: number) {
  const list = (await read($, inboxState)) ?? []
  if (!list.length) return
  const appeared = (i: OrcInboxItem) => !!i.spawn && Object.values(map).some(a => a.description === i.spawn!.description && a.startedAt >= i.at - 1000)
  if (list.some(i => !i.ackedAt && appeared(i))) await inboxAck($, appeared, 'sweep: agent appeared')
  await inboxDeliverIfIdle($, 'sweep')
  const kept = ((await read($, inboxState)) ?? []).filter(i => !i.ackedAt || now - i.ackedAt < INBOX_RETIRE_MS)
  if (kept.length !== list.length) await update($, inboxState, () => kept)
  for (const i of kept.filter(x => !x.ackedAt && x.kind === 'spawn' && x.delivered.length >= 3)) $.ui.log(`orc: inbox ${i.id} delivered ${i.delivered.length}× and "${i.spawn?.description}" has not appeared`, { to: 'debug' })
}

/** A spawn or a relay for the main loop: the brief goes to a file, the instruction to the inbox. */
async function relayViaMain($: EngineInterface, kind: 'send' | 'spawn-verifier' | 'spawn-integrator' | 'spawn-orchestrator', payload: { to?: string; text?: string; description?: string; prompt?: string; web?: boolean }): Promise<OrcInboxItem> {
  const stamp = await $.clock.now()
  const path = `${OUT_DIR}/relay-${kind}-${stamp}.md`
  await $.fs.write(path, payload.text ?? payload.prompt ?? '')
  if (kind === 'send') return inboxPush($, { kind: 'notice', text: `deliver the file ${path} VERBATIM as a message to agent ${payload.to} using SendMessage (to: "${payload.to}", summary: "orc wake relay"). If the file is older than 10 minutes, prefix one line saying so.` })
  const type = kind === 'spawn-integrator' ? 'orc:integrator' : kind === 'spawn-orchestrator' ? 'orc:orchestrator' : payload.web ? 'orc:verifier-web' : 'orc:verifier'
  return inboxPush($, { kind: 'spawn', text: '', spawn: { type, description: payload.description ?? type, path } })
}


// ---- switch 3: write boundary -------------------------------------------------

const isScratch = (p: string) => SCRATCH_PREFIXES.some(x => p.startsWith(x)) || p.startsWith(`${OUT_DIR}/`)

function normPath(p: string, root: string) {
  let x = p.trim().replace(/^['"]|['"]$/g, '')
  if (x.startsWith('~/')) x = `${HOME}/` + x.slice(2)
  if (!x.startsWith('/')) x = `${root}/${x.replace(/^\.\//, '')}`
  const parts: string[] = []
  for (const seg of x.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

/** Is `abs` inside the boundary? Allowed: scratch locations; anything under root that matches an allow entry (file or dir prefix). */
function inBoundary(abs: string, b: { root: string; allow: string[] }) {
  if (isScratch(abs)) return true
  const root = b.root.replace(/\/+$/, '')
  if (abs !== root && !abs.startsWith(root + '/')) return false
  const rel = abs === root ? '' : abs.slice(root.length + 1)
  return b.allow.some(a => rel === a || rel.startsWith(a + '/'))
}

/** Split a shell command on ; & | only outside quotes; and split a segment into words keeping quoted strings whole (quotes stripped, inner spaces kept). */
function shellSegments(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!
    if (q) {
      cur += ch
      if (ch === q) q = null
      else if (ch === '\\' && q === '"') cur += cmd[++i] ?? ''
      continue
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue }
    if (ch === '\\') { cur += ch + (cmd[++i] ?? ''); continue }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') { if (cur.trim()) out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}
function shellWords(seg: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = []
  let cur = ''
  let quoted = false
  let q: string | null = null
  const flush = () => { if (cur) out.push({ text: cur, quoted }); cur = ''; quoted = false }
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]!
    if (q) { if (ch === q) q = null; else cur += ch; continue }
    if (ch === "'" || ch === '"') { q = ch; quoted = true; continue }
    if (/\s/.test(ch)) { flush(); continue }
    cur += ch
  }
  flush()
  return out
}

/** Is `abs` an ancestor directory of an allowed path (so creating or staging it is reasonable)? */
function isAncestorOfAllowed(abs: string, b: { root: string; allow: string[] }) {
  const root = b.root.replace(/\/+$/, '')
  if (abs === root) return false
  if (!abs.startsWith(root + '/')) return false
  const rel = abs.slice(root.length + 1)
  return b.allow.some(a => a.startsWith(rel + '/'))
}

const WRITE_VERB_RE = /^\s*(?:(?:do|then|else|sudo|env\s+\S+=\S+)\s+)?(tee|sed -i|cp|mv|rm|mkdir|touch|chmod|chown|ln|install|rsync|truncate|dd|patch)\b/
const PATHISH = (tok: string) => (tok.includes('/') || /\.[a-z0-9]{1,6}$/i.test(tok)) && !tok.startsWith('-') && !/^(https?:|git@)/.test(tok)

/** EXACT part: returns a deny reason for Edit/Write outside the boundary and for git staging outside it or sweeping. */
function boundaryCheck(tool: string, args: Record<string, unknown>, b: { root: string; allow: string[] }): { target: string; reason: string } | undefined {
  const allowText = b.allow.join(' ')
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const fp = typeof args.file_path === 'string' ? args.file_path : typeof args.notebook_path === 'string' ? args.notebook_path : ''
    if (!fp) return undefined
    const abs = normPath(fp, b.root)
    return inBoundary(abs, b) ? undefined : { target: abs, reason: `orc boundary: ${tool} on ${abs} is outside your may_change (${allowText}). Stop and report if you need it.` }
  }
  if (tool !== 'Bash') return undefined
  const full = typeof args.command === 'string' ? args.command : ''
  const { code, masked } = shellMask(full)
  if (sweepsStage(full)) {
    return { target: 'git add -A / commit -a', reason: `orc boundary: stage paths explicitly; -A, --all, "." and commit -a are denied (your may_change: ${allowText}).` }
  }
  const gitAdd = /\bgit\s+(?:add|stage)\s+([^;&|\n]+)/d.exec(masked)
  if (gitAdd?.indices?.[1]) {
    for (const tok of shellWords(code.slice(gitAdd.indices[1][0], gitAdd.indices[1][1])).map(w => w.text).filter(t => t && !t.startsWith('-') && !t.startsWith('$'))) {
      const abs = normPath(tok, b.root)
      if (!inBoundary(abs, b) && !isAncestorOfAllowed(abs, b)) return { target: abs, reason: `orc boundary: git add ${tok} is outside your may_change (${allowText}).` }
    }
  }
  return undefined
}

/** AUDIT part (never denies): shell commands that look like writes outside the boundary, flagged for the wake. Skips $VARs and cd-relative ambiguity. */
function shellSuspect(args: Record<string, unknown>, b: { root: string; allow: string[] }): { target: string; reason: string } | undefined {
  const allowText = b.allow.join(' ')
  const full = typeof args.command === 'string' ? args.command : ''
  const cmd = full.split(/<<-?\s*['"]?\w+['"]?/)[0] ?? full
  if (/(^|[;&|\n])\s*cd\s+/.test(cmd)) return undefined // relative paths after a cd are not resolvable here; the audit at return covers them
  // redirects
  for (const m of cmd.matchAll(/(?:^|[^<>])>{1,2}\s*([^\s;&|]+)/g)) {
    const tok = m[1]!
    if (/^&\d/.test(tok) || tok === '/dev/null' || /^\d+$/.test(tok) || /[()"']/.test(tok)) continue
    if (tok.startsWith('$')) continue
    const abs = normPath(tok, b.root)
    if (!inBoundary(abs, b) && !isAncestorOfAllowed(abs, b)) return { target: abs, reason: `shell redirect to ${abs} looks outside may_change (${allowText}); audited, not denied.` }
  }
  // mutating verbs: every path-looking argument of that segment must be inside
  for (const seg of shellSegments(cmd)) {
    const m = WRITE_VERB_RE.exec(seg)
    if (!m) continue
    const words = shellWords(seg.trim()).filter(w => !/^(do|then|else|sudo|env)$/.test(w.text) && !/=/.test(w.text))
    // quoted words are expressions or messages, not paths, unless they are plain path-looking strings
    const args = words.slice(1).filter(w => PATHISH(w.text) && !/^[sy]\//.test(w.text) && !(w.quoted && /[\s{}()\[\]*$]/.test(w.text))).map(w => w.text)
    const toks = m[1] === 'sed -i' ? args.slice(-1) : args
    for (const tok of toks) {
      if (tok.startsWith('$')) continue
      const abs = normPath(tok, b.root)
      if (!inBoundary(abs, b) && !isAncestorOfAllowed(abs, b)) return { target: abs, reason: `"${seg.trim().slice(0, 60)}" looks like a write to ${abs} outside may_change (${allowText}); audited, not denied.` }
    }
  }
  return undefined
}

/** Switch 3 (reshaped): mechanical dispatch preflight. Hard findings are launch-threatening; soft ones are advisory. */
async function dispatchPreflight($: EngineInterface, prompt: string, boundary: { root: string; allow: string[] } | undefined, check: { command: string; cwd: string } | undefined, siblings: OrcAgent[]): Promise<{ ok: boolean; hard: string[]; soft: string[] }> {
  const hard: string[] = []
  const soft: string[] = []
  if (!/^CHECK:\s*\S/m.test(prompt)) hard.push('no CHECK: line in the prompt (the registered check cannot run on return)')
  if (!/^CHECK_CWD:\s*\//m.test(prompt)) hard.push('no absolute CHECK_CWD: line in the prompt')
  if (!/^MAY_CHANGE:\s*\S/m.test(prompt)) hard.push('no MAY_CHANGE: line in the prompt (no write boundary will apply)')
  if (check) {
    try {
      if (!(await $.fs.exists(check.cwd))) hard.push(`CHECK_CWD ${check.cwd} does not exist`)
      else {
        const syn = await $.process.run(['/bin/sh', '-n', '-c', check.command], { cwd: check.cwd, timeoutMs: 10000 })
        if (syn.exitCode !== 0) hard.push(`CHECK does not parse as shell: ${short(syn.stderr.trim(), 120)}`)
        if (/\{[^{}\s]*,[^{}\s]*\}/.test(check.command)) hard.push('CHECK contains a brace list {a,b} that sh expands into several words before running it (a JS object literal in node -e breaks this way): put the check in a script file, e.g. ops/checks/<id>.sh, and use CHECK: bash ops/checks/<id>.sh')
        const first = shellSegments(check.command)[0]?.trim().split(/\s+/).find(w => !/=/.test(w) && !/^(cd|env|do|then)$/.test(w))
        if (first && !first.includes('/')) {
          const which = await $.process.run(['/bin/sh', '-c', `command -v ${first}`], { cwd: check.cwd, timeoutMs: 10000 })
          if (which.exitCode !== 0) hard.push(`CHECK's first command "${first}" is not on PATH`)
        }
      }
    } catch (err) {
      soft.push(`could not preflight the check command: ${short(String(err), 80)}`)
    }
  }
  if (boundary) {
    for (const a of boundary.allow) {
      if (a.startsWith('/') || a.includes('..')) { hard.push(`MAY_CHANGE entry "${a}" must be repo-relative without ..`); continue }
      const parent = a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : ''
      if (parent) {
        try {
          const exists = await $.fs.exists(`${boundary.root}/${parent}`)
          const parentAllowed = boundary.allow.some(x => x === parent || parent.startsWith(x + '/'))
          if (!exists && !parentAllowed) soft.push(`parent directory ${parent}/ of "${a}" does not exist yet; creating it is granted`)
        } catch {
          /* ignore */
        }
      }
    }
    for (const sib of siblings) {
      if (!sib.boundary || !(sib.status === 'running' || sib.status === 'pending')) continue
      const overlaps = boundary.allow.filter(a => sib.boundary!.allow.some(x => a === x || a.startsWith(x + '/') || x.startsWith(a + '/')))
      if (overlaps.length) soft.push(`boundary overlaps running child ${sib.id.slice(0, 7)} "${short(sib.description, 24)}" on: ${overlaps.join(' ')} (write collision possible)`)
    }
  }
  return { ok: hard.length === 0, hard, soft }
}

/** Orchestrator-side commit scope: no sweeping stages. */
function orchestratorCommitCheck(args: Record<string, unknown>): string | undefined {
  if (typeof args.command === 'string' && sweepsStage(args.command)) {
    return 'orc boundary: name the paths you stage; "git add -A", "git add .", "--all" and "git commit -a" are denied for the orchestrator (they sweep builders\' unfinished files).'
  }
  return undefined
}

/** Audit at return: changed files in the repo outside this child's boundary, split by whether another running child owns them. */
async function boundaryAudit($: EngineInterface, row: OrcAgent, siblings: OrcAgent[]): Promise<NonNullable<OrcAgent['boundaryReport']> | undefined> {
  if (!row.boundary) return undefined
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: row.boundary.root, timeoutMs: 30000 })
    const files = ran.stdout.split('\n').map(l => l.slice(3).trim()).filter(Boolean).map(f => (f.includes(' -> ') ? f.split(' -> ')[1]! : f))
    if (row.worktree) {
      // In a clone every changed file is this builder's; what matters is what it left uncommitted.
      return { outside: files.filter(f => !inBoundary(normPath(f, row.boundary!.root), row.boundary!)), othersRunning: files.filter(f => inBoundary(normPath(f, row.boundary!.root), row.boundary!)).map(f => `${f} (UNCOMMITTED in clone; a merge will not include it)`), checkedAt: await $.clock.now() }
    }
    const outside: string[] = []
    const othersRunning: string[] = []
    for (const f of files) {
      const abs = normPath(f, row.boundary.root)
      if (inBoundary(abs, row.boundary)) continue
      const owner = siblings.find(sib => sib.id !== row.id && (sib.status === 'running' || sib.status === 'pending') && sib.boundary && inBoundary(abs, sib.boundary))
      if (owner) othersRunning.push(`${f} (running child ${owner.id.slice(0, 7)})`)
      else if (/^ops\//.test(f)) othersRunning.push(`${f} (orchestrator's own ops/)`)
      else outside.push(f)
    }
    return { outside, othersRunning, checkedAt: await $.clock.now() }
  } catch {
    return undefined
  }
}

function boundaryBlock(row: OrcAgent, rep: NonNullable<OrcAgent['boundaryReport']> | undefined) {
  const denied = row.denied ?? []
  const sus = row.suspects ?? []
  const pf = row.preflight ? ` · preflight ${row.preflight.ok ? 'clean' : 'HARD: ' + row.preflight.hard.join('; ')}${row.preflight.soft.length ? ` (${row.preflight.soft.length} note${row.preflight.soft.length > 1 ? 's' : ''})` : ''}` : ''
  const head = `[write boundary] may_change: ${row.boundary?.allow.join(' ') ?? '—'}${pf} · denied (exact): ${denied.length}` + (denied.length ? ` (${denied.slice(0, 5).map(d => `${d.tool}→${d.target.replace(row.boundary?.root ?? '', '.')}`).join(', ')})` : '') + ` · shell writes flagged for audit: ${sus.length}` + (sus.length ? ` (${sus.slice(0, 5).map(d => d.target.replace(row.boundary?.root ?? '', '.')).join(', ')})` : '')
  if (!rep) return head + ' · audit: unavailable'
  const outside = rep.outside.length ? `OUTSIDE BOUNDARY (uncommitted changes not owned by any running child): ${rep.outside.join(', ')}` : 'audit: no changed files outside the boundary'
  const others = rep.othersRunning.length ? ` · belongs to running children: ${rep.othersRunning.join(', ')}` : ''
  return `${head}\n${outside}${others}`
}

/** Switch 2: run a child's registered check on return; pass / fail / unavailable, never a throw. */
async function runCheck($: EngineInterface, row: OrcAgent): Promise<NonNullable<OrcAgent['checkResult']>> {
  if (!row.check) return { status: 'unavailable', exitCode: null, ms: 0, outputTail: '', reason: 'no CHECK: line was registered at dispatch' }
  const t0 = await $.clock.now()
  try {
    const ran = await $.process.run(['/bin/sh', '-c', row.check.command], { cwd: row.check.cwd, timeoutMs: row.check.timeoutMs ?? CHECK_TIMEOUT_MS })
    const ms = (await $.clock.now()) - t0
    const out = `${ran.stdout}\n${ran.stderr}`.trim()
    const tail = out.split('\n').slice(-40).join('\n').slice(-4000)
    return { status: ran.exitCode === 0 ? 'pass' : 'fail', exitCode: ran.exitCode, ms, outputTail: tail }
  } catch (err) {
    const ms = (await $.clock.now()) - t0
    return { status: 'unavailable', exitCode: null, ms, outputTail: '', reason: short(String(err), 300) }
  }
}

function checkBlock(row: OrcAgent, res: NonNullable<OrcAgent['checkResult']>) {
  const head = `[registered check] ${res.status.toUpperCase()}${res.exitCode !== null ? ` (exit ${res.exitCode})` : ''} in ${clock(res.ms)} · command: ${row.check?.command ?? '—'} · cwd: ${row.check?.cwd ?? '—'}${res.reason ? ` · reason: ${res.reason}` : ''}`
  return res.outputTail ? `${head}\n--- check output (tail) ---\n${res.outputTail}` : head
}

// 32-bit FNV-1a, hex: a cheap content digest for report pointers (not security).
function digest(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const ago = (ms: number, now: number) => `${clock(now - ms)} ago`

/** The full projection: every child, its state, the mark, a pointer to its saved report. Written to a file on every wake. */
function fullLedger(map0: Record<string, OrcAgent>, orchId: string, now: number) {
  const orch0 = map0[orchId]
  const map = orch0 && orchId === MAIN_ORCH ? Object.fromEntries(Object.entries(map0).filter(([, a]) => a.id === orchId || a.parentId !== orchId || a.startedAt >= orch0.startedAt - 1000)) : map0
  const kids = Object.values(map).filter(a => a.parentId === orchId).sort((a, b) => a.startedAt - b.startedAt)
  const orch = map[orchId]
  const state = (a: OrcAgent) => (a.status === 'running' || a.status === 'pending' ? 'running' : a.status === 'completed' ? 'returned' : a.status)
  const lines = kids.map(a => {
    const st = state(a)
    const when = st === 'running' ? `running since ${iso(a.startedAt)} (${ago(a.startedAt, now)})` : `${st} ${iso(a.endedAt ?? now)} (${ago(a.endedAt ?? now, now)})`
    const mark = a.mark ? `${a.mark.verdict}: ${a.mark.note}` : st === 'returned' ? 'UNMARKED' : '—'
    const chk = a.checkResult ? ` · check ${a.checkResult.status}${a.checkResult.exitCode !== null ? ` (exit ${a.checkResult.exitCode})` : ''}` : a.check ? ' · check registered' : ''
    const wt = a.worktree ? ` · clone ${a.worktree.branch}${a.worktree.merged ? ` (${a.worktree.merged})` : ''}` : ''
    const ptr = a.reportPath ? ` · report ${a.reportPath} (${kb(a.reportBytes ?? 0)}, ${a.reportDigest})` : ''
    return `  ${a.id.slice(0, 7)}  ${a.type.slice(4).padEnd(10)} "${short(a.description, 40)}"  ${when}${chk}${wt}  mark: ${mark}${ptr}`
  })
  const runs = (orch?.integration?.runs ?? []).map(r => `  ${iso(r.at)}  after ${short(r.after, 30)}: ${r.status}${r.exitCode !== null ? ` (exit ${r.exitCode})` : ''} in ${clock(r.ms)}${r.load !== undefined && r.cores ? ` at load ${r.load}/${r.cores}` : ''}`)
  const vr = (orch?.verifyRequests ?? []).map(v => `  ${iso(v.at)}  ${v.stage} (${v.id})`)
  return [
    `# orc full ledger · orchestrator ${orchId.slice(0, 7)} · cursor ${orch?.cursor ?? 0} · as of ${iso(now)}`,
    `This is the substrate's projection: returns, checks, merges and your marks; never quality. Read it only when you have lost context.`,
    '',
    `## children (${kids.length})`,
    ...lines,
    '',
    `## integration runs (${runs.length})`,
    ...(runs.length ? runs : ['  none yet']),
    '',
    `## verification requests (${vr.length})`,
    ...(vr.length ? vr : ['  none']),
    '',
  ].join('\n')
}

/** The wake a ledger-mode orchestrator receives: only what CHANGED since its last wake and what is ACTIONABLE now.
 *  returnedId undefined = no child returned (an integration result alone). */
/** Wake budget (lab: ops/DESIGN-WAKES.md): the child's own report rides whole when it fits, else its head and a pointer. */
const WAKE_REPORT_BUDGET = 2600
const WAKE_TAIL_LINES = 15
const tailLines = (text: string, n: number, cap = 1500) => text.split('\n').slice(-n).join('\n').slice(-cap)
/** An integration FAIL tail reduced to its verdict lines plus the last five lines. */
function failLines(tail: string) {
  const ls = tail.split('\n')
  const keep = ls.filter(l => /^\s*(FAIL|SKIP|INTEGRATION|Error|error:|Traceback)/.test(l))
  return [...new Set([...keep, ...ls.slice(-5)])].join('\n').slice(-1200)
}
/** A passing check's tail reduced to its measured facts (test counts, timings, OK/PASS lines): at most 4 lines on one line. */
function evidenceDigest(tail: string) {
  const facts = tail.split('\n').map(l => l.trim()).filter(l => l && /\b(Ran \d+|\d+ (passed|failed|tests?)|elapsed|INTEGRATION|OK\b|PASS\b|\d+(\.\d+)?\s?(s|ms|sec)\b)/.test(l))
  return facts.slice(-4).map(l => short(l, 90)).join(' · ')
}
function budgetReport(text: string, path: string | undefined) {
  if (text.length <= WAKE_REPORT_BUDGET) return text
  const cut = text.lastIndexOf('\n', WAKE_REPORT_BUDGET)
  const head = text.slice(0, cut > 400 ? cut : WAKE_REPORT_BUDGET)
  return `${head}\n… [report cut at ${head.length} of ${text.length} chars; full text: ${path ?? 'the ledger report file'}]`
}

/** The wake: the delta the orchestrator acts on, in the order it acts (orient → returned → proved → claimed → also changed →
 *  actionable → running → one pointer line). Every section is O(delta) or capped; history never rides a wake. */
function ledgerWake(map0: Record<string, OrcAgent>, orchId: string, returnedId: string | undefined, now: number, answer: string) {
  const orch0 = map0[orchId]
  const map = orch0 && orchId === MAIN_ORCH ? Object.fromEntries(Object.entries(map0).filter(([, a]) => a.id === orchId || a.parentId !== orchId || a.startedAt >= orch0.startedAt - 1000)) : map0
  const kids = Object.values(map).filter(a => a.parentId === orchId).sort((a, b) => a.startedAt - b.startedAt)
  const orch = map[orchId]
  const cursor = orch?.cursor ?? 0
  const state = (a: OrcAgent) => (a.status === 'running' || a.status === 'pending' ? 'running' : a.status === 'completed' ? 'returned' : a.status)
  const running = kids.filter(a => state(a) === 'running')
  const unmarked = kids.filter(a => state(a) !== 'running' && !a.mark && a.id !== returnedId)
  const just = returnedId ? map[returnedId] : undefined
  const merged = kids.filter(k => k.worktree?.merged === 'merged').length
  const reqs = orch?.verifyRequests ?? []
  const typeOf = (stage: string) => (stage === 'integration' ? 'orc:integrator' : 'orc:verifier')
  const stages = reqs.map(v => v.stage)
  const phase = stages.includes('final') ? 'final' : stages.includes('checkpoint') ? 'post-checkpoint' : 'pre-checkpoint'
  const pendingVer = reqs.filter(v => !kids.some(k => baseType(k.type) === typeOf(v.stage) && k.startedAt >= v.at - 2000 && state(k) !== 'running'))
  const cloneBase = kids.find(k => k.worktree?.base)?.worktree?.base
  const repo = orch?.integration?.repo ?? reqs[reqs.length - 1]?.repo ?? cloneBase ?? '(not known until the first dispatch)'
  const lines: string[] = []
  lines.push(`[orc wake] cursor ${cursor} · ${iso(now)} · orchestrator ${orchId.slice(0, 7)}`)
  lines.push(`STATE: repo ${repo} · phase ${phase} · children ${kids.length} (merged ${merged}, unmarked ${unmarked.length + (just && !just.mark ? 1 : 0)}, running ${running.length}) · verification pending: ${pendingVer.length ? pendingVer.map(v => v.stage).join(', ') : 'none'}`)
  if (just) {
    const cr = just.checkResult
    const rep = just.boundaryReport
    const dur = clock((just.endedAt ?? now) - just.startedAt)
    const outcome = just.status === 'completed' ? 'returned' : `ended ${just.status}`
    const chk = cr ? `check ${cr.status.toUpperCase()}${cr.exitCode !== null && cr.status !== 'pass' ? ` (exit ${cr.exitCode})` : ''}` : just.check ? 'check pending' : 'no registered check'
    const violations = rep?.outside.length ?? 0
    const denied = just.denied?.length ?? 0
    const sus = just.suspects?.length ?? 0
    const bndClean = !violations && !denied && !sus
    const bnd = just.boundary ? (bndClean ? 'boundary clean' : `boundary: ${violations} file(s) OUTSIDE grant, ${denied} denied, ${sus} shell writes flagged`) : ''
    const mergeState = just.worktree ? (just.worktree.merged ? `merge ${just.worktree.merged}` : 'clone awaits your mark') : ''
    lines.push(`RETURNED: ${just.id.slice(0, 7)} "${just.description}" (${just.type.slice(4)}) ${outcome} after ${dur}, ${just.toolCalls} tool calls · ${[chk, bnd, mergeState].filter(Boolean).join(' · ')}`)
    const proved: string[] = []
    if (cr) proved.push(`${chk}, run by the substrate on return: ${just.check?.command ?? '—'} (cwd ${just.check?.cwd ?? '—'})${cr.reason ? ` — ${cr.reason}` : ''}${cr.status === 'pass' && cr.outputTail && evidenceDigest(cr.outputTail) ? ` — evidence: ${evidenceDigest(cr.outputTail)}` : ''}`)
    if (just.boundary) {
      const root = just.boundary.root
      proved.push(bndClean
        ? `boundary clean (may_change: ${just.boundary.allow.join(' ')})`
        : `${bnd}${violations ? ` — OUTSIDE: ${rep!.outside.join(', ')}` : ''}${denied ? ` — denied: ${just.denied!.slice(0, 5).map(d => `${d.tool}→${d.target.replace(root, '.')}`).join(', ')}` : ''}${sus ? ` — flagged: ${just.suspects!.slice(0, 5).map(d => d.target.replace(root, '.')).join(', ')}` : ''}`)
      if (rep?.othersRunning.length) proved.push(`changed files owned by running children: ${rep.othersRunning.join(', ')}`)
    }
    if (just.preflight && !just.preflight.ok) proved.push(`preflight HARD at dispatch: ${just.preflight.hard.join('; ')}`)
    if (proved.length) lines.push(`PROVED by the substrate (do not redo): ${proved.join(' · ')}`)
    if (cr && cr.status !== 'pass' && cr.outputTail) lines.push(`--- check output (last ${WAKE_TAIL_LINES} lines) ---\n${tailLines(cr.outputTail, WAKE_TAIL_LINES)}`)
    lines.push(`CLAIMED by the child (judge it against the proof above; spot-check only what the check does not cover):\n${budgetReport(answer, just.reportPath)}`)
  }
  const changed: string[] = []
  const heldRuns = (orch?.integration?.runs ?? []).filter(r => !r.reported)
  for (const [ri, r] of heldRuns.entries()) {
    const loadNote = r.load !== undefined && r.cores ? ` · load ${r.load} on ${r.cores} cores${r.load > r.cores ? ' (LOADED: a timing miss here is noise, re-time before acting)' : ''}` : ''
    changed.push(`• integration check after merge of ${r.after}: ${r.status.toUpperCase()}${r.exitCode !== null ? ` (exit ${r.exitCode})` : ''} in ${clock(r.ms)}${loadNote}${r.status !== 'pass' ? (r.redispatched ? ' · the integrator is being dispatched to diagnose; its report arrives as a wake' : ' · same failing steps as the previous run (known pending item); no integrator dispatched') : ''}`)
    // A repeat's failing steps are already in an earlier run's lines: print them for new failures and the latest run only.
    if (r.status !== 'pass' && r.tail && (r.redispatched || ri === heldRuns.length - 1)) changed.push(failLines(r.tail).split('\n').map(l => '  ' + l).join('\n'))
  }
  if (changed.length) lines.push(`ALSO CHANGED:\n${changed.join('\n')}`)
  else if (!just) lines.push('CHANGED: nothing new (this wake was re-delivered)')
  const actionable: string[] = []
  if (just) actionable.push(`mark ${just.id.slice(0, 7)} with mcp__orc__mark${just.worktree && !just.worktree.merged ? ' (accepted merges its clone)' : ''}`)
  for (const a of unmarked.slice(0, 5)) actionable.push(`${a.id.slice(0, 7)} "${short(a.description, 30)}" returned ${ago(a.endedAt ?? now, now)}, still UNMARKED${a.reportPath ? ` (report ${a.reportPath})` : ''}`)
  if (unmarked.length > 5) actionable.push(`+${unmarked.length - 5} more unmarked (mcp__orc__status lists them)`)
  for (const v of pendingVer) {
    const started = kids.some(k => baseType(k.type) === typeOf(v.stage) && k.startedAt >= v.at - 2000)
    actionable.push(`${v.stage} verification requested ${ago(v.at, now)}: ${started ? 'running, report pending' : 'being dispatched'}`)
  }
  lines.push(`ACTIONABLE: ${actionable.length ? actionable.join('; ') : 'nothing pending'}`)
  lines.push(`RUNNING: ${running.length}${running.length ? ` — ${running.slice(0, 5).map(a => `${a.id.slice(0, 7)} "${short(a.description, 24)}" (${ago(a.startedAt, now)})`).join(', ')}${running.length > 5 ? `, +${running.length - 5} more` : ''}` : ''}`)
  lines.push(`(context loss only: ledger ${OUT_DIR}/ledger/${orchId.slice(0, 7)}.md · state on demand: mcp__orc__status)`)
  return lines.join('\n')
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Orchestrator effort' })
}

// ---- the mod ----------------------------------------------------------------

export const register: Register = on => {
  // The orchestrator brief rides the main session's system prompt while a main-mode mission runs, appended to the
  // environment section (always rendered; prompt.section works on engines older than prompt.compose). The section is
  // cached by the engine and re-rendered only when refreshPins invalidates it at mission start and end.
  on('prompt.section', async ($, e, next) => {
    const r = await next(e)
    if (e.name !== 'env_info_simple') return r
    const m = await read($, missionState)
    if (missionDoneHere(m)) return { text: `${r.text ?? ''}\n\n${doneSection(m)}` }
    if (!mainMissionLive(m) || !mainOrch((await read($, agents)) ?? {})) return r
    const brief = orchestratorBrief(m)
    if (briefNoted !== m.startedAt) { briefNoted = m.startedAt; await note($, { kind: 'note', agentId: MAIN_ORCH, text: `orchestrator brief rendered into the system prompt (${brief.length} chars)` }) }
    const atR = await $.clock.now()
    await patchMission($, x => ({ ...x, brief: { ...(x.brief ?? { chars: brief.length, renders: [] }), renders: [...(x.brief?.renders ?? []), atR].slice(-20) } }))
    return { text: `${r.text ?? ''}\n\n${brief}` }
  })

  // orc's own files belong to the mission the owner approved: while it runs, read-only tools may look inside orc's data
  // folder (the relay prompts it asks the main session to read, saved reports) and the clones and verifier snapshots it
  // cut beside the repository, without a dialog. Nothing else is decided here. (v0.15.0 permission test on 2.1.288's
  // default mode: 5 dialogs, all "read outside the working directories": 4 relay prompts, 1 spot check in a clone.)
  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    if (r?.decision) return r
    const ev = e as unknown as { tool_name?: string; tool_input?: { file_path?: unknown; path?: unknown } }
    if (browserCallAllowed(String(ev.tool_name ?? '')) && (await read($, missionState))?.status === 'running') {
      await note($, { kind: 'note', text: `browser call allowed without a dialog: ${String(ev.tool_name)} (granted at gate 2)` })
      return { ...(r ?? {}), decision: { behavior: 'allow' as const } }
    }
    const root = ownReadRoot(String(ev.tool_name ?? ''), ev.tool_input, await read($, missionState), OUT_DIR, HOME)
    if (!root) return r
    await note($, { kind: 'note', text: `read allowed without a dialog: ${short(String(ev.tool_input?.file_path ?? ev.tool_input?.path ?? ''), 80)} (orc's own ${root === OUT_DIR ? 'data folder' : 'clones'})` })
    return { ...(r ?? {}), decision: { behavior: 'allow' as const } }
  })

  // The harness's task notification for an orc child repeats what orc delivers: auto mode absorbs graph children's (the
  // runner reports through its ping policy), and any orc child of the main orchestrator during a live mission
  // (v0.14.0: 7 of 23 orchestrator turns, 1.5M tokens, answered a notification and then the wake for the same child).
  on('prompt.submit', async ($, e, next) => {
    const kind = (e.origin as { kind?: string } | undefined)?.kind
    if (kind === 'task-notification') {
      const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]
      const row = id ? ((await read($, agents)) ?? {})[id] : undefined
      const runnerOwns = !!row && row.type === 'orc:integrator' && ((await read($, missionState))?.graph?.runnerIntegrators ?? []).includes(row.id)
      if (id && ((await graphNodeOf($, id)) || runnerOwns)) return { drop: `orc: the graph runner handles ${id.slice(0, 7)}'s result` }
      // The completion hook wakes the main orchestrator for every orc child it owns; the harness submits its notification
      // before that hook has run (v0.14.1 live: a relay-state test let the final verifier's notification through).
      if (id && row && row.parentId === MAIN_ORCH && row.type.startsWith('orc:') && mainMissionLive(await read($, missionState))) {
        await note($, { kind: 'note', agentId: row.id, text: 'task notification absorbed: the result arrives as an orc wake' })
        return { drop: `orc: ${id.slice(0, 7)}'s result arrives as an orc wake` }
      }
    }
    return next(e)
  })

  // Pin the orc tools the orchestrator (or the intake) uses every turn, so it never needs ToolSearch for them.
  on('tool.describe', async ($, e, next) => {
    const r = await next(e)
    if (!e.tool.startsWith('mcp__orc__')) return r
    const m = await read($, missionState)
    const pin = (ORC_LOOP_TOOLS.includes(e.tool) && mainMissionLive(m)) || (ORC_INTAKE_TOOLS.includes(e.tool) && !!m && INTAKE_STATES.includes(m.status)) || (e.tool === 'mcp__orc__continue' && missionDoneHere(m))
    return pin ? { ...r, isDeferred: false } : r
  })

  // Any compaction of the main session during a main-mode mission (auto or /compact): tell the summarizer what to keep,
  // record the state it hit, and orient the orchestrator afterwards. (The plugin's own forced compaction records itself.)
  on('session.compact', async ($, e, next) => {
    if (e.agentId) return next(e)
    const m = await read($, missionState)
    if (!mainMissionLive(m)) return next(e)
    let tokens: number | undefined
    try { tokens = (await $.session.usage()).context.tokens } catch { tokens = undefined }
    const at = await compactionStarts($, String(e.trigger), tokens)
    const r = await next({ ...e, instructions: [e.instructions, compactKeep(m)].filter(Boolean).join('\n\n') })
    try { await compactionDone($, at) } catch (err) { $.ui.log(`orc: post-compaction orientation failed: ${String(err)}`) }
    return r
  })

  on('session.start', async ($, e, next) => {
    await loadConfig($)
    try { SESSION_ID = await $.session.id() } catch { SESSION_ID = '' }
    SESSION_STARTED = await $.clock.now()
    try {
      await $.command.register({
      name: 'orc',
      description: 'orc: `begin <request>` opens the owner intake (interview → gate 1 understanding → gate 2 plan & rules → run); `approve|correct <note>|defer` answer a pending gate; `resume [repo]` picks a mission up from the repository state; `allow-edit|lock-edit` override/restore the plugin edit lock while a mission runs; `directive <text>` records a standing owner rule; `continue <request>` continues a finished mission with the next request under the approved rules (no new gates); `backlog [add <request>|next]`; `understanding` prints the package; `policy retry=N parallel=N ping=…` tunes a running graph (auto mode); `computer [on|off]` shows or sets the mission computer (sandbox, browser, network); `start <mission.md> [repo=<path>] [amendment=<path>] [final=<path>]` starts a mission from a file; `status`; or the pane / `turns`, `agents`, `journal`, `export`, `clear`',
      argumentHint: '[begin <request>|approve|correct <note>|defer|resume [repo]|continue <request>|directive <text>|backlog [add|next]|understanding|policy ...|computer [on|off]|start <mission.md> ...|status|turns|agents|journal|export|clear]',
      })
    } catch (err) {
      // A user skill or another plugin may own /orc; the substrate must still load (tools, agent types, hooks).
      $.ui.log(`orc: /orc command not registered (${short(String(err), 120)}); use the mcp__orc__* tools instead`)
    }

    const CORE = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']
    try {
      await $.tool.register({
        name: 'mark',
        description: 'Ledger mode: record your verdict on a returned child. taskId = the child id (7+ chars) or its exact description; verdict = accepted | rejected | redo; note = one line of why (what you ran).',
        inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, verdict: { type: 'string', enum: ['accepted', 'rejected', 'redo'] }, note: { type: 'string' } }, required: ['taskId', 'verdict', 'note'] },
      })
    } catch (err) {
      $.ui.log(`orc: tool.register mark failed: ${String(err)}`)
    }
    try {
      await $.tool.register({
        name: 'request_verification',
        description: 'Request an independent verification now. stage = checkpoint (mission done-means), final (mission + amendment) or integration (the integrator updates and runs the repository-level integration check). The substrate dispatches the agent and wakes you with its report; the result is a receipt.',
        inputSchema: { type: 'object', properties: { stage: { type: 'string', enum: ['checkpoint', 'final', 'integration'] }, note: { type: 'string' }, repo: { type: 'string', description: 'absolute repository path; needed only before any builder has been dispatched' } }, required: ['stage'] },
      })
    } catch (err) {
      $.ui.log(`orc: tool.register request_verification failed: ${String(err)}`)
    }
    try {
      await $.tool.register({
        name: 'start',
        description: 'Start a mission: give the mission file (markdown with a "Repository:" line or pass repo), optionally an amendment file and a final-report path. The substrate writes the orchestrator prompt and puts a spawn instruction in the main-loop inbox; do not spawn it before that item arrives. Refuses a repository that already holds a run (ops/DECISIONS.md or the final report exists) unless fresh is true.',
        inputSchema: { type: 'object', properties: { mission: { type: 'string' }, repo: { type: 'string' }, amendment: { type: 'string' }, final: { type: 'string' }, archive: { type: 'boolean', description: 'true: move a repository that already holds a run aside (<repo>.prev-<date>) and start fresh' }, fresh: { type: 'boolean', description: 'true: start even though the repository already holds a run' } }, required: ['mission'] },
      })
    } catch (err) {
      $.ui.log(`orc: tool.register start failed: ${String(err)}`)
    }
    if (LAB) try {
      await $.tool.register({
        name: 'demo',
        description: 'Run the bundled example mission end to end (archives a previous run, starts the orchestrator through the inbox, and scores the result with the owner-held acceptance suite when the final report lands). Same as /orc demo.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'bundled example: wordfreq (default) or tradelog' }, mode: { type: 'string', enum: ['subagent', 'main'], description: 'main: this session orchestrates' }, compactAt: { type: 'number', description: 'lab, main mode: force a compaction once context reaches this many tokens' } } },
      })
    } catch (err) {
      $.ui.log(`orc: tool.register demo failed: ${String(err)}`)
    }
    for (const spec of [
      { name: 'owner_context', description: 'Owner intake: the drafting contract, the package shape, the repository facts and the current mission state (findings, last owner decision and note). Read it before drafting or revising an understanding.', inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'absolute repository path; defaults to the current mission or the session repository' } } } },
      { name: 'draft_understanding', description: 'Owner intake: validate and store one complete understanding package (WorkHub owner-journey shape; see owner_context). Returns findings to fix; empty findings = ready to request approval. Replaces the current draft; a new version after approval.', inputSchema: { type: 'object', properties: { repo: { type: 'string' }, understanding: { type: 'object', description: 'the package (mission, finalPicture, plan, team, executionPolicy, executionTarget, sourceEvidence, openQuestions)' } }, required: ['understanding'] } },
      { name: 'request_understanding', description: 'Owner intake: present the drafted understanding for the owner\'s decision (approve / correct / defer) in the /orc pane. Refused while findings remain. The owner decides; there is no tool to approve.', inputSchema: { type: 'object', properties: { repo: { type: 'string' } } } },
      { name: 'request_permission', description: 'Owner intake, GATE 2: after gate 1 (understanding) is approved and the plan + rules (with options[]) are drafted, present the plan and the recommended rules for the owner\'s decision. Approval starts the mission through the substrate.', inputSchema: { type: 'object', properties: { repo: { type: 'string' } } } },
      { name: 'resume', description: 'Resume a mission from <repo>/ops/orc/state.json in this session: restores the intake (gates), or makes this session the orchestrator again with the snapshot\'s children adopted and a delta of what is pending.', inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'absolute repository path; defaults to the session repository' } } } },
      { name: 'directive', description: 'Record a standing owner directive on the current mission (durable in the repository state; shown on resume and in UNDERSTANDING.md). Use it when the owner states a rule or preference mid-mission.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'run_graph', description: 'Auto mode: hand the substrate a Workbench brief (JSON). It preflights the brief, spawns each ready node\'s builder, runs the node check, has a verifier check the clone, merges on PASS, sends failures back to the SAME builder within the retry budget, and pings you only by the brief\'s ping policy (an exhausted node always pings). Main-session orchestrator only.', inputSchema: { type: 'object', properties: { brief: { type: 'string', description: 'path to the brief, absolute or repo-relative' } }, required: ['brief'] } },
      { name: 'graph_status', description: 'Auto mode: the graph run node by node (status, retries, last failure), the policy and the gates.', inputSchema: { type: 'object', properties: {} } },
      { name: 'graph_decide', description: 'Auto mode: answer a graph ping. retry = one more attempt for a failed node (your note is sent as the fix); skip = accept the gap and let dependents start; abort = start nothing new.', inputSchema: { type: 'object', properties: { node: { type: 'string' }, action: { type: 'string', enum: ['retry', 'skip', 'abort'] }, note: { type: 'string' } }, required: ['action'] } },
      { name: 'steer', description: 'Send one of your children a short steering message. A running child reads it with its next tool result; a finished child is resumed with it, its context intact, and reports again as a wake. Use it to correct course: a verifier about to fail work that is still being built, a builder misreading its order. It cannot widen a child\'s write boundary.', inputSchema: { type: 'object', properties: { taskId: { type: 'string', description: 'the child id (or its first 7 characters, or its description)' }, message: { type: 'string', description: 'one or two plain sentences' } }, required: ['taskId', 'message'] } },
      { name: 'backlog', description: 'The mission backlog in the repository state: list, add <request>, or next (start the next queued request as a new intake once the current mission is done).', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'next'] }, request: { type: 'string' } }, required: ['action'] } },
      { name: 'continue', description: 'Continue a FINISHED mission with the owner\'s next request, in their words (the next phase, "carry on until done", a follow-up). No new interview or gate: the approved understanding, plan, rules and standing directives carry into a new version under orc, with clones, checks, verifiers, merges and the pane; the request is recorded as the amendment and the approval. Use it instead of orchestrating by hand after ops/FINAL.md. Same as /orc continue <request>.', inputSchema: { type: 'object', properties: { request: { type: 'string', description: "the owner's request, verbatim" } }, required: ['request'] } },
    ]) {
      try { await $.tool.register(spec) } catch (err) { $.ui.log(`orc: tool.register ${spec.name} failed: ${String(err)}`) }
    }
    try {
      await $.tool.register({
        name: 'status',
        description: 'Pull the substrate state on demand (no wake): returned children you have not marked, verification requests without a report, running children, integration-check results since your last wake (including held PASS results), and the last merges.',
        inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
      })
    } catch (err) {
      $.ui.log(`orc: tool.register status failed: ${String(err)}`)
    }
    for (const spec of [
      { name: 'orchestrator', description: 'Orchestrator on the orc substrate: background wake with a delta ledger, registered checks on return, write boundaries with dispatch preflight, per-builder clones merged at acceptance, substrate-dispatched verifiers and an integration check after every merge (no MCP).', prompt: ORCHESTRATOR_FULL_PROMPT, tools: [...CORE, 'Agent', 'mcp__orc__mark', 'mcp__orc__steer', 'mcp__orc__request_verification', 'mcp__orc__status'] },
      { name: 'integrator', description: 'Integrator: owns ops/integration/check.sh for one repository; may change only ops/integration/; reports defects, never fixes product code.', prompt: INTEGRATOR_PROMPT, tools: CORE },
      { name: 'builder', description: 'Builder: implements one scoped work order in its own clone, commits by name.', prompt: BUILDER_PROMPT, tools: CORE },
      { name: 'verifier', description: 'Verifier: checks done-means by running things; changes nothing.', prompt: VERIFIER_PROMPT, tools: ['Read', 'Bash', 'Grep', 'Glob'] },
    ]) {
      try {
        await $.agent.register({ ...spec, ...(LAB_MODEL ? { model: LAB_MODEL } : {}), ...(LAB_EFFORT ? { effort: LAB_EFFORT } : {}), ...(WORKERS_READ_CLAUDE_MD ? {} : { omitClaudeMd: true as const }), mcpServers: [] })
      } catch (err) {
        $.ui.log(`orc: agent.register ${spec.name} failed: ${String(err)}`)
      }
    }
    // The orc computer: a builder and a verifier that also hold the mission's browser (local pages only). Spawning one
    // is refused unless gate 2 granted that role a browser.
    const server = browserServer()
    if (server) {
      const browserLine = '\n\nYou also have a browser of your own: the mcp__orc-browser__* tools (headless, its own in-memory profile, local pages only: http://localhost or 127.0.0.1). Measure pages with browser_resize, browser_navigate and browser_evaluate (it runs in the page). To check a page, serve it locally (e.g. python3 -m http.server <port> --bind 127.0.0.1 in your directory), open it, then stop the server. Never try to reach an outside site.'
      for (const spec of [
        { name: 'builder-web', description: 'Builder with the mission browser (only when gate 2 granted builders a browser): implements one scoped work order in its own clone, commits by name.', prompt: BUILDER_PROMPT + browserLine, tools: [...CORE, ...SAFE_BROWSER_TOOLS], disallowedTools: UNSAFE_BROWSER_TOOLS },
        { name: 'verifier-web', description: 'Verifier with the mission browser (only when gate 2 granted verifiers a browser): checks done-means by running things and looking at pages; changes nothing.', prompt: VERIFIER_PROMPT + browserLine, tools: ['Read', 'Bash', 'Grep', 'Glob', ...SAFE_BROWSER_TOOLS], disallowedTools: UNSAFE_BROWSER_TOOLS },
      ]) {
        try {
          await $.agent.register({ ...spec, ...(LAB_MODEL ? { model: LAB_MODEL } : {}), ...(LAB_EFFORT ? { effort: LAB_EFFORT } : {}), ...(WORKERS_READ_CLAUDE_MD ? {} : { omitClaudeMd: true as const }), mcpServers: [{ 'orc-browser': server }] })
        } catch (err) {
          $.ui.log(`orc: agent.register ${spec.name} failed: ${String(err)}`)
        }
      }
    }

    try {
      const top = await $.process.run(['/bin/sh', '-c', 'git rev-parse --show-toplevel 2>/dev/null || pwd'], { timeoutMs: 5000 })
      const repo0 = top.stdout.trim()
      if (repo0 && (await $.fs.exists(`${missionDir(repo0)}/state.json`))) {
        const st = JSON.parse(await $.fs.read(`${missionDir(repo0)}/state.json`)) as OrcMission
        const line = `this repository holds mission v${st.version} (${st.status}): /orc resume picks it up`
        $.ui.log(line)
        $.ui.toast(line)
      }
    } catch { /* no mission here */ }
    try {
      const once = `${OUT_DIR}/continue-on-reload.txt`
      if (LAB && (await $.fs.exists(once))) {
        const text = (await $.fs.read(once)).trim()
        if (text) {
          await $.fs.write(once, '')
          $.ui.log(`orc: continuing from continue-on-reload.txt (${text.length} chars)`)
          void $.prompt.submit({ text })
        }
      }
    } catch (err) {
      $.ui.log(`orc: continue-on-reload failed: ${String(err)}`, { to: 'debug' })
    }
    let ticks = 0

    $.clock.every(2000, async () => {
      ticks += 1
      const map = (await read($, agents)) ?? {}
      const running = Object.values(map).filter(a => a.status === 'running' || a.status === 'pending' || (a.status === 'completed' && !a.reportPath && a.parentId && isLedgerType(map[a.parentId]?.type ?? '') && a.type.startsWith('orc:')))
      const open = await read($, cur)
      const hasStranded = Object.values(map).some(a => isLedgerType(a.type) && (a.pendingWakes?.length ?? 0) > 0)
      const hasDue = Object.values(map).some(a => isIntegType(a.type) && a.integration?.due)
      if (ticks % 5 === 0) {
        try { await scoreDemo($) } catch (err) { $.ui.log(`orc: demo scoring failed: ${String(err)}`, { to: 'debug' }) }
        try { await syncMissionState($) } catch (err) { $.ui.log(`orc: mission sync failed: ${String(err)}`, { to: 'debug' }) }
        try { await settleMission($) } catch (err) { $.ui.log(`orc: mission settle failed: ${String(err)}`, { to: 'debug' }) }
        try { await maybeForceCompact($) } catch (err) { $.ui.log(`orc: forced compaction failed: ${String(err)}`, { to: 'debug' }) }
      }
      const inboxList = (await read($, inboxState)) ?? []
      const inboxOpen = inboxList.some(i => !i.ackedAt)
      // Fresh inbox items go out from this 2 s tick, not at push time: a prompt submitted while a slash command or a
      // tool call is still running is lost on some engines. Redelivery of unacknowledged items stays on the sweep.
      const nowTick = await $.clock.now()
      if (inboxList.some(i => !i.ackedAt && i.delivered.length === 0 && nowTick - i.at > 1500)) {
        try { await inboxDeliverIfIdle($, 'tick') } catch (err) { $.ui.log(`orc: inbox delivery failed: ${String(err)}`, { to: 'debug' }) }
      }
      // A gate that waits for the owner is asked in the question dialog once the session is idle (not mid-turn, no
      // inbox item still going out).
      if (GATE_DIALOG && !open && !inboxOpen) {
        const mg = await read($, missionState)
        if (mg && (mg.status === 'understanding_requested' || mg.status === 'permission_requested') && askedGate !== gateKey(mg)) void askGate($)
      }
      if (running.length === 0 && !open && !inboxOpen && !hasStranded && !hasDue) return
      if (hasDue && ticks % 5 === 0) {
        try {
          await processIntegration($)
        } catch (err) {
          $.ui.log(`orc: integration run failed: ${String(err)}`)
        }
      }
      if (ticks % 15 === 0) {
        try {
          const live = await $.agent.list()
          const nowF = await $.clock.now()
          // Child liveness (Track A, item 5): a running lab child with no tool call for 12 minutes gets reported to
          // its orchestrator once, with what it was last doing; the orchestrator decides (wait, message, stop).
          for (const a of Object.values(map).filter(x => x.type.startsWith('orc:') && !x.type.startsWith('orc:orchestrator') && (x.status === 'running' || x.status === 'pending') && !x.livenessNotified)) {
            const last = a.lastProgressAt ?? a.startedAt
            const st = live.find(x => x.id === a.id)?.status
            if (st === 'running' && nowF - last > LIVENESS_MINUTES * 60000) {
              const par = a.parentId ? map[a.parentId] : undefined
              await patchAgent($, a.id, r => ({ ...r, livenessNotified: true }))
              if (par && isLedgerType(par.type)) {
                const text = `[orc liveness] child ${a.id.slice(0, 7)} "${a.description}" has made no tool call for ${clock(nowF - last)} (running ${clock(nowF - a.startedAt)}, ${a.steps} model requests, last tool: ${a.lastTool ?? 'none'}). It may be thinking, hung, or waiting on something it cannot get. Decide: wait, send it a message, or stop it (TaskStop) and re-dispatch; a child that is stopped returns with no report.`
                await deliverWake($, par.id, a.id, text)
                await note($, { kind: 'send', agentId: a.id, text: `liveness notice → ${par.id.slice(0, 7)}` })
              }
            }
          }
          for (const orch of Object.values(map).filter(a => isLedgerType(a.type) && a.id !== MAIN_ORCH && (a.pendingWakes?.length ?? 0) > 0)) {
            const st = live.find(x => x.id === orch.id)?.status
            const idle = !st || !(st === 'running' || st === 'pending')
            const oldest = Math.min(...orch.pendingWakes!.map(w => w.at))
            if (idle && nowF - oldest > 45000) {
              const queued = orch.pendingWakes!
              await patchAgent($, orch.id, a => ({ ...a, pendingWakes: [] }))
              const text = queued.length === 1 ? queued[0]!.text : `[orc ledger] ${queued.length} wakes arrived while you were busy; oldest first.\n\n` + queued.map(q => q.text).join('\n\n=====\n\n')
              await relayViaMain($, 'send', { to: orch.id, text })
              await note($, { kind: 'send', agentId: orch.id, text: `flushed ${queued.length} stranded wake(s) via main` })
            }
          }
          await inboxSweep($, map, await $.clock.now())
        } catch (err) {
          $.ui.log(`orc: inbox sweep failed: ${String(err)}`, { to: 'debug' })
        }
      }
      // Dead-man sweep (every 30 s): only for children the engine ended without any event we could hook.
      if (running.length > 0 && ticks % 15 === 0) {
        const live = await $.agent.list()
        const now = await $.clock.now()
        for (const a of running) {
          const seen = live.find(x => x.id === a.id)
          if (seen && (seen.status !== a.status || (a.status === 'completed' && !a.reportPath))) {
            const ended = seen.status === 'running' ? undefined : (a.endedAt ?? now)
            await patchAgent($, a.id, row => ({ ...row, status: seen.status, endedAt: row.endedAt ?? ended }))
            if (ended) await note($, { kind: 'turn', agentId: a.id, text: `${seen.status}: ${short(a.description, 60)}` })
            const par = a.parentId ? map[a.parentId] : undefined
            // A 'completed' child is reported by its own turn.complete (which carries the report); only
            // children the engine ended without one (failed/killed/aborted) are woken from here, and a
            // completed child only if no report has arrived 90 s after it ended.
            // Not while the relay is still running the child's registered check (up to the 5-min cap).
            const endedWithoutReport = ended && !a.reportPath && !a.relaying && (seen.status !== 'completed' || now - ended > 330000)
            if (endedWithoutReport && par && isLedgerType(par.type)) {
              try {
                const cursor = (par.cursor ?? 0) + 1
                await patchAgent($, par.id, p => ({ ...p, cursor }))
                await patchAgent($, a.id, p => ({ ...p, returnedCursor: cursor, reportPath: `${OUT_DIR}/ledger/${par.id.slice(0, 7)}-${a.id.slice(0, 7)}.md`, reportBytes: 0, reportDigest: 'none' }))
                const fresh = (await read($, agents)) ?? {}
                // Recover the child's last message from its transcript, so a failed relay degrades to a late wake, not an empty one.
                let recovered = ''
                try {
                  const res = await $.session.messages({ agentId: a.id })
                  const msgs = Array.isArray(res) ? res : []
                  for (let i = msgs.length - 1; i >= 0 && !recovered; i--) {
                    const m = msgs[i] as unknown as { role?: string; text?: string; content?: unknown }
                    if (m.role !== 'assistant') continue
                    const t = typeof m.text === 'string' ? m.text : Array.isArray(m.content) ? (m.content as { type?: string; text?: string }[]).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text!).join('\n') : ''
                    if (t.trim()) recovered = t.trim()
                  }
                } catch {
                  /* transcript unavailable */
                }
                const msg = recovered
                  ? `(the substrate's relay of this child's report did not complete; its last message, recovered from its transcript, follows)\n\n${recovered}`
                  : `(no report: the engine ended this child with status "${seen.status}" after ${a.steps} model requests and ${a.toolCalls} tool calls; decide whether to re-dispatch it)`
                await $.fs.write(`${OUT_DIR}/ledger/${par.id.slice(0, 7)}-${a.id.slice(0, 7)}.md`, `# ${a.description}\n${msg}\n`)
                await relayViaMain($, 'send', { to: par.id, text: ledgerWake(fresh, par.id, a.id, now, msg) })
                await note($, { kind: 'send', agentId: a.id, text: `wake (ended ${seen.status}) → ${par.id.slice(0, 7)} via main` })
              } catch (err) {
                $.ui.log(`orc: wake on ended child failed: ${String(err)}`)
              }
            }
          }
        }
      }
      await update($, tick, n => (n ?? 0) + 1)
      if (running.length > 0) {
        try {
          await writeAgents($)
        } catch {
          /* best effort */
        }
      }
      if (open) {
        try {
          const id = await $.session.id()
          await $.fs.write(`${OUT_DIR}/${id}.live.json`, JSON.stringify({ ...open, tools: open.tools.slice(-200), asOf: await $.clock.now() }))
        } catch {
          /* best effort */
        }
      }
    })

    const opened = await openPane($)
    if (!opened.isPlaced) $.ui.log(`orc: pane waits (${opened.reason}); /orc opens it`, { to: 'debug' })
    return next(e)
  })

  // ---- turns (main loop) ----------------------------------------------------

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const done = (await read($, turns)) ?? []
    const fresh: OrcTurn = {
      n: done.length + 1,
      turnId: e.turnId,
      startedAt,
      prompt: short(flat(e.text), 200),
      steps: 0,
      modelMs: 0,
      contextTokens: 0,
      outputTokens: 0,
      outProseChars: 0,
      outThinkChars: 0,
      outArgChars: 0,
      classes: {},
      activities: {},
      tools: [],
      spawned: [],
      finished: [],
    }
    await update($, cur, () => fresh)
    if (!(e as { agentId?: string }).agentId) {
      const txt = flat(e.text)
      if (txt.includes('[orc inbox]')) await inboxAck($, i => i.kind !== 'spawn' && txt.includes(`(${i.id},`), 'prompt ran')
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const t0 = await $.clock.now()
    let ctx = 0
    let out = 0
    let prose = 0
    let think = 0
    let argc = 0
    const owner = e.agentId ? ((await read($, agents)) ?? {})[e.agentId] : undefined
    const isLab = owner?.type.startsWith('orc:') === true || (owner?.parentId !== undefined && (((await read($, agents)) ?? {})[owner.parentId]?.type.startsWith('orc:') ?? false))
    const stream = isLab && LAB_EFFORT && e.effort !== LAB_EFFORT ? next({ ...e, effort: LAB_EFFORT }) : next(e)
    for await (const c of stream) {
      if (c.kind === 'text') prose += c.text.length
      else if (c.kind === 'thinking') think += c.text.length
      else if (c.kind === 'input') argc += c.json.length
      else if (c.kind === 'stop' && c.usage) {
        ctx = c.usage.input_tokens + c.usage.cache_read_input_tokens + c.usage.cache_creation_input_tokens
        out = c.usage.output_tokens
      }
      yield c
    }
    const ms = (await $.clock.now()) - t0
    if (e.agentId) {
      await patchAgent($, e.agentId, a => ({
        ...a,
        status: 'running',
        endedAt: undefined,
        steps: a.steps + 1,
        modelMs: a.modelMs + ms,
        outProseChars: (a.outProseChars ?? 0) + prose,
        outThinkChars: (a.outThinkChars ?? 0) + think,
        outArgChars: (a.outArgChars ?? 0) + argc,
        ctxTokens: ctx || a.ctxTokens,
        ctxMax: Math.max(a.ctxMax ?? 0, ctx),
        ctxFirst: a.ctxFirst || ctx,
      }))
    } else {
      await patchCur($, t => ({
        ...t,
        steps: t.steps + 1,
        modelMs: t.modelMs + ms,
        contextTokens: ctx || t.contextTokens,
        outputTokens: t.outputTokens + out,
        outProseChars: (t.outProseChars ?? 0) + prose,
        outThinkChars: (t.outThinkChars ?? 0) + think,
        outArgChars: (t.outArgChars ?? 0) + argc,
      }))
      {
        const mc = await read($, missionState)
        const lastC = mc?.compactions?.slice(-1)[0]
        if (mainMissionLive(mc) && lastC?.compactedAt && lastC.ctxAfter === undefined && ctx) {
          const acctC = await promptAccounting($)
          await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(c => (c.at === lastC.at ? { ...c, ctxAfter: ctx, systemPromptAfter: acctC.sp } : c)) }))
        }
        if (mainMissionLive(mc) && mc.brief && mc.brief.spAfter === undefined && mc.brief.renders.length) {
          const acctB = await promptAccounting($)
          if (acctB.sp !== undefined) await patchMission($, x => ({ ...x, brief: x.brief ? { ...x.brief, spAfter: acctB.sp } : x.brief }))
        }
      }
      // The main session as orchestrator: its own model effort goes on the `main` row too.
      if (mainOrch((await read($, agents)) ?? {})) await patchAgent($, MAIN_ORCH, a => ({ ...a, steps: a.steps + 1, modelMs: a.modelMs + ms, outProseChars: (a.outProseChars ?? 0) + prose, outThinkChars: (a.outThinkChars ?? 0) + think, outArgChars: (a.outArgChars ?? 0) + argc, ctxTokens: ctx || a.ctxTokens, ctxMax: Math.max(a.ctxMax ?? 0, ctx), ctxFirst: a.ctxFirst || ctx, lastProgressAt: Date.now() }))
    }
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId) {
      const u = e.usage
      let map = (await read($, agents)) ?? {}
      const row0 = map[e.agentId]
      if (row0 && row0.steps === 0 && row0.toolCalls === 0 && row0.type.startsWith('orc:')) {
        // Substrate-spawned child: the engine skipped our hooks for its loop. Backfill counts from its transcript.
        try {
          const msgs = await $.session.messages({ agentId: e.agentId })
          if (Array.isArray(msgs)) {
            let steps = 0
            let toolCalls = 0
            const classes: Partial<Record<OrcClass, OrcBucket>> = {}
            const acts: Partial<Record<OrcActivity, OrcBucket>> = {}
            for (const m of msgs) {
              if (m.role !== 'assistant') continue
              steps += 1
              for (const tu of m.toolUses ?? []) {
                toolCalls += 1
                const input = (tu as unknown as { input?: Record<string, unknown> }).input ?? {}
                const name = (tu as unknown as { name?: string }).name ?? 'unknown'
                const { cls } = classify(name, input)
                const act = activityOf(name, cls, input)
                const text = (tu as unknown as { text?: string }).text ?? ''
                const bump = (b0: OrcBucket | undefined) => { const b = { ...(b0 ?? emptyBucket()) }; b.count += 1; b.inBytes += text.length; return b }
                classes[cls] = bump(classes[cls])
                acts[act] = bump(acts[act])
              }
            }
            await patchAgent($, e.agentId, a => ({ ...a, steps, toolCalls, classes, activities: acts, lastTool: 'backfilled from transcript' }))
            map = (await read($, agents)) ?? map
          }
        } catch (err) {
          $.ui.log(`orc: backfill for ${e.agentId.slice(0, 7)} failed: ${String(err)}`, { to: 'debug' })
        }
      }
      const row = map[e.agentId]
      await patchAgent($, e.agentId, a => ({
        ...a,
        status: e.reason === 'answer' ? 'completed' : e.reason,
        runs: (a.runs ?? 0) + 1,
        endedAt: now,
        inputTokens: a.inputTokens + (u?.input_tokens ?? 0),
        outputTokens: a.outputTokens + (u?.output_tokens ?? 0),
        cacheReadTokens: a.cacheReadTokens + (u?.cache_read_input_tokens ?? 0),
        cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
        answerHead: short(flat(e.answer), 160),
      }))
      if (row) {
        await patchCur($, t => ({
          ...t,
          finished: [...t.finished, { id: row.id, type: row.type, ms: now - row.startedAt, tools: row.toolCalls, outputTokens: row.outputTokens + (u?.output_tokens ?? 0) }],
        }))
      }
      await note($, { kind: 'turn', agentId: e.agentId, text: `${e.reason} after ${clock(e.durationMs)}${u ? ` · ${k(u.output_tokens)} out` : ''}: ${short(flat(e.answer), 70)}` })
      // An orchestrator just went idle: flush wakes that arrived while it was busy (one message, oldest first).
      if (row && isLedgerType(row.type) && (row.pendingWakes?.length ?? 0) > 0) {
        const queued = row.pendingWakes ?? []
        await patchAgent($, row.id, a => ({ ...a, pendingWakes: [] }))
        const text = queued.length === 1 ? queued[0]!.text : `[orc ledger] ${queued.length} wakes arrived while you were busy; oldest first.\n\n` + queued.map(q => q.text).join('\n\n=====\n\n')
        try {
          await $.session.send({ to: row.id, text })
          await note($, { kind: 'send', agentId: row.id, text: `flushed ${queued.length} queued wake(s)` })
        } catch (err) {
          $.ui.log(`orc: flush of queued wakes failed: ${String(err)}`)
        }
      }
      // Wake: relay a lab child's final report to its orchestrator parent so the parent resumes.
      const parent = row?.parentId ? map[row.parentId] : undefined
      if (row && parent && parent.type.startsWith('orc:orchestrator') && row.type.startsWith('orc:')) {
        await patchAgent($, row.id, a => ({ ...a, relaying: true }))
        try {
          let text: string
          if (isLedgerType(parent.type)) {
            // Save the full report once; the wake carries the delta in full and history as pointers.
            const reportPath = `${OUT_DIR}/ledger/${parent.id.slice(0, 7)}-${row.id.slice(0, 7)}.md`
            let answerText = e.reason === 'answer' ? e.answer : `(no report: the child ended with reason "${e.reason}" after ${row.steps} model requests and ${row.toolCalls} tool calls; decide whether to re-dispatch it)`
            const ownReport = answerText
            if (isChecksType(parent.type) && isCheckedChild(row.type)) {
              const res = await runCheck($, row)
              await patchAgent($, row.id, a => ({ ...a, checkResult: res }))
              // An integrator's return ran the integration check at HEAD: any merge still waiting on it is covered.
              if (row.type === 'orc:integrator') await patchAgent($, parent.id, a => ({ ...a, integration: a.integration ? { ...a.integration, due: undefined } : a.integration }))
              let boundaryText = ''
              if (isBoundType(parent.type) && row.boundary) {
                const sibs = Object.values((await read($, agents)) ?? {}).filter(a => a.parentId === parent.id)
                const rep = await boundaryAudit($, row, sibs)
                if (rep) await patchAgent($, row.id, a => ({ ...a, boundaryReport: rep }))
                boundaryText = `\n${boundaryBlock((await read($, agents))?.[row.id] ?? row, rep)}`
              }
              answerText = `${checkBlock(row, res)}${boundaryText}\n\n--- builder's own report ---\n${answerText}`
            }
            const body = `# ${row.description}\nchild ${row.id} (${row.type}) · returned ${new Date(now).toISOString()} · reason ${e.reason} · ${clock(now - row.startedAt)} · ${row.toolCalls} tool calls\n\n${answerText}\n`
            await $.fs.write(reportPath, body)
            let cursor = 0
            await patchAgent($, parent.id, a => { cursor = (a.cursor ?? 0) + 1; return { ...a, cursor } })
            await patchAgent($, row.id, a => ({ ...a, reportPath, reportBytes: e.answer.length, reportDigest: digest(e.answer), returnedCursor: cursor }))
            const fresh = (await read($, agents)) ?? {}
            text = isNoLedger(parent.type)
              ? `[orc wake] child ${row.id.slice(0, 7)} "${row.description}" (${row.type}) returned with reason ${e.reason} after ${clock(now - row.startedAt)}, ${row.toolCalls} tool calls. Read your STATUS.md first, then act on the evidence below and record your verdict with mcp__orc__mark.\n\n${answerText}`
              : ledgerWake(fresh, parent.id, row.id, now, ownReport)
            try { await $.fs.write(`${OUT_DIR}/wakes/${parent.id.slice(0, 7)}-${String(cursor).padStart(3, '0')}-${row.id.slice(0, 7)}.md`, text) } catch { /* best effort */ }
            if (!isNoLedger(parent.type)) await markReported($, fresh, parent.id, now)
          } else {
            text = `[orc wake] child "${row.description}" (${row.type}, id ${row.id}) finished with reason ${e.reason} after ${clock(now - row.startedAt)}, ${row.toolCalls} tool calls. Its final report follows. Read your STATUS.md, verify the claim by running things, then continue.\n\n${e.answer}`
          }
          const unread = ((await read($, agents)) ?? {})[row.id]?.steers?.filter(x => !x.deliveredAt) ?? []
          if (unread.length) {
            text += `\nSTEER NOT READ: ${row.id.slice(0, 7)} finished before reading ${unread.length === 1 ? 'your steer' : `${unread.length} steers`} ("${short(unread[unread.length - 1]!.text, 80)}"). If it still matters, steer it again: that resumes it with its context.`
            await patchAgent($, row.id, a => ({ ...a, steers: (a.steers ?? []).filter(x => x.deliveredAt) }))
          }
          const graphHit = parent.id === MAIN_ORCH ? await graphNodeOf($, row.id) : undefined
          if (graphHit) await graphOnReturn($, row, e.reason, e.answer)
          else if (parent.id === MAIN_ORCH && (await graphOwnsIntegrator($, row))) { /* accepted by the runner */ }
          else await deliverWake($, parent.id, row.id, text)
          await note($, { kind: 'send', agentId: row.id, text: `wake → ${parent.id.slice(0, 7)} (${short(row.description, 30)})` })
        } catch (err) {
          $.ui.log(`orc: wake relay failed: ${String(err)}`)
        } finally {
          await patchAgent($, row.id, a => ({ ...a, relaying: false }))
        }
      }
      try {
        await writeAgents($)
      } catch (err) {
        $.ui.log(`orc: agents write failed: ${String(err)}`, { to: 'debug' })
      }
      return next(e)
    }
    if (mainOrch((await read($, agents)) ?? {})) {
      const u = e.usage
      await patchAgent($, MAIN_ORCH, a => ({ ...a, inputTokens: a.inputTokens + (u?.input_tokens ?? 0), outputTokens: a.outputTokens + (u?.output_tokens ?? 0), cacheReadTokens: a.cacheReadTokens + (u?.cache_read_input_tokens ?? 0), cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) }))
    }
    const open = await read($, cur)
    if (open) {
      const closed: OrcTurn = { ...open, endedAt: now, reason: e.reason, answer: short(flat(e.answer), 200) }
      await update($, turns, list => [...(list ?? []), closed].slice(-TURNS_CAP))
      await update($, cur, () => null)
      // The session is idle now: the inbox's prompt door opens.
      try { await inboxDeliverIfIdle($, 'turn end') } catch (err) { $.ui.log(`orc: inbox delivery at turn end failed: ${String(err)}`, { to: 'debug' }) }
      try {
        await writeLedger($)
      } catch (err) {
        $.ui.log(`orc: ledger write failed: ${String(err)}`, { to: 'debug' })
      }
    }
    return next(e)
  })

  // ---- event-driven: verification as an action with a receipt ------------------------

  on('tool.call', { tool: 'mcp__orc__request_verification' }, async ($, e) => {
    if (!(e as unknown as { agentId?: string }).agentId) { try { await logAfterCompaction($, 'mcp__orc__request_verification', String((e as unknown as { stage?: unknown }).stage ?? '')) } catch { /* best effort */ } }
    const input = e as unknown as { stage?: unknown; note?: unknown; agentId?: string }
    const stage = input.stage === 'checkpoint' || input.stage === 'final' || input.stage === 'integration' ? input.stage : undefined
    if (!stage) return { deny: 'orc request_verification: stage must be "checkpoint", "final" or "integration"' }
    const map = (await read($, agents)) ?? {}
    const orch = input.agentId ? map[input.agentId] : mainOrch(map)
    if (!orch || !isLedgerType(orch.type)) return { deny: 'orc request_verification: only an orchestrator (a lab orchestrator agent, or the main session while it runs an approved mission) may request verification' }
    const roots = [...new Set(kidsOf(map, orch).filter(a => a.check?.cwd).map(a => a.worktree ? a.check!.cwd.replace(a.worktree.path, a.worktree.base) : a.check!.cwd))]
    const override = typeof (input as { repo?: unknown }).repo === 'string' ? ((input as { repo: string }).repo).trim() : ''
    const mis = orch.id === MAIN_ORCH ? await read($, missionState) : null
    const repo = (override && override.startsWith('/') && (await $.fs.exists(override))) ? override : (mis?.status === 'running' ? mis.repo : roots[0])
    if (!repo) return { deny: 'orc request_verification: the repository is unknown (no builder has been dispatched yet); pass repo: "<absolute path>" or dispatch first' }
    let mission = '', amendment = '', finalPath = ''
    try {
      const text = await $.fs.read(`${repo}/ops/DECISIONS.md`)
      mission = /^MISSION:\s*(\S+)/m.exec(text)?.[1] ?? ''
      amendment = /^AMENDMENT:\s*(\S+)/m.exec(text)?.[1] ?? ''
      finalPath = /^FINAL:\s*(\S+)/m.exec(text)?.[1] ?? ''
    } catch {
      /* fall through */
    }
    if (!mission) return { deny: `orc request_verification: ${repo}/ops/DECISIONS.md must start with MISSION: and AMENDMENT: lines` }
    finalPath ||= `${repo}/ops/FINAL.md`
    const at = await $.clock.now()
    const id = `vr-${stage}-${at}`
    if (stage === 'integration') {
      if (!isIntegType(orch.type)) return { deny: 'orc request_verification: integration passes exist only for the integration-mode orchestrator' }
      const noteText = typeof input.note === 'string' && input.note.trim() ? `: ${short(input.note.trim(), 120)}` : ''
      const ok = await dispatchIntegrator($, map, orch, repo, `requested by the orchestrator${noteText}`)
      await patchAgent($, orch.id, a => ({ ...a, verifyRequests: [...(a.verifyRequests ?? []), { id, stage, at, repo }] }))
      return { result: ok ? `receipt ${id}: integration pass requested at ${new Date(at).toISOString()} for ${repo}; the integrator is being dispatched and its report will arrive as a wake. This receipt is not a verdict.` : `receipt ${id}: an integrator is already running or was dispatched under 90 s ago; its report will arrive as a wake. No second one was dispatched.` }
    }
    const description = `auto verifier: ${stage} [for ${orch.id.slice(0, 7)}]`
    const snap = await makeSnapshot($, repo, stage)
    const item = await relayViaMain($, 'spawn-verifier', { web: !!BROWSER && browserGranted(await read($, missionState), 'verifier'), description, prompt: VERIFIER_BRIEF(stage, repo, mission, amendment || '(none)', finalPath, snap, stage === 'checkpoint' && typeof input.note === 'string' ? short(input.note.trim(), 400) : undefined) })
    let spawnNow = ''
    if (orch.id === MAIN_ORCH) {
      await inboxMarkDelivered($, [item.id], 'tool-result')
      spawnNow = ` SPAWN NOW, in this turn (inbox ${item.id}): Agent tool, subagent_type "${item.spawn!.type}", description "${description}", run_in_background true, prompt = the full contents of ${item.spawn!.path} (read the file first). Spawn it once, then continue; its report arrives as a wake.`
    }
    await patchAgent($, orch.id, a => ({ ...a, verifyRequests: [...(a.verifyRequests ?? []), { id, stage, at, repo, snapshot: snap?.path }] }))
    await note($, { kind: 'spawn', agentId: orch.id, text: `request_verification ${stage} → ${id}${snap ? ` @ ${snap.sha.slice(0, 7)}` : ' (no snapshot)'}` })
    const dirty = snap?.dirty ? ` WARNING: uncommitted changes in ${repo} (${snap.dirty}) are NOT in the snapshot; commit and request again if they matter.` : ''
    return { result: `receipt ${id}: ${stage} verification requested at ${new Date(at).toISOString()} for ${repo}${snap ? ` at commit ${snap.sha.slice(0, 12)} (snapshot ${snap.path})` : ' (no snapshot: the verifier checks the live repository)'}; ${orch.id === MAIN_ORCH ? 'you spawn the verifier (instruction below)' : 'the verifier is being dispatched through the main loop'} and its report will arrive as a wake. This receipt is not a verdict.${dirty}${spawnNow}` }
  })

  on('tool.call', { tool: 'mcp__orc__owner_context' }, async ($, e) => {
    const input = e as unknown as { repo?: unknown; agentId?: string }
    if (input.agentId) return { deny: 'orc owner_context: the owner intake runs in the main session only' }
    return { result: await ownerContext($, await repoOf($, typeof input.repo === 'string' ? input.repo : undefined)) }
  })

  on('tool.call', { tool: 'mcp__orc__draft_understanding' }, async ($, e) => {
    const input = e as unknown as { repo?: unknown; understanding?: unknown; agentId?: string }
    if (input.agentId) return { deny: 'orc draft_understanding: the owner intake runs in the main session only' }
    if (!input.understanding || typeof input.understanding !== 'object') return { deny: 'orc draft_understanding: understanding must be an object (see owner_context for the shape)' }
    const u = JSON.parse(JSON.stringify(input.understanding)) as OrcUnderstanding
    const repo = await repoOf($, typeof input.repo === 'string' ? input.repo : (u.executionTarget?.repositoryPath))
    const at = await $.clock.now()
    const prev = await read($, missionState)
    const same = prev && prev.repo === repo ? prev : undefined
    // Gate 1 approved → we are drafting the plan (stage 2) on the same version; after gate 2 → a new version.
    // A stage-2 redraft that changes what gate 1 approved reopens gate 1 (status drafting, stage 1).
    const reopens = !!same && ['understood', 'permission_requested'].includes(same.status) && !!same.gate1Digest && gate1DigestOf(u) !== same.gate1Digest
    const afterGate1 = !!same && ['understood', 'permission_requested'].includes(same.status) && !reopens
    const afterGate2 = !!same && ['approved', 'running', 'done'].includes(same.status)
    const stage: 1 | 2 = afterGate1 ? 2 : 1
    const findings = validateUnderstanding(u, stage)
    const version = same ? (afterGate2 ? same.version + 1 : same.version) : 1
    const status: OrcMission['status'] = afterGate1 ? 'understood' : 'drafting'
    const next: OrcMission = { ...(same ?? {}), repo, dir: missionDir(repo), version, status, mode: same?.mode ?? 'main', understanding: u, findings, decisions: afterGate2 ? [] : (same?.decisions ?? []), updatedAt: at }
    await update($, missionState, () => next)
    await persistMission($, next)
    await note($, { kind: 'note', agentId: 'owner', text: `understanding v${version} stage ${stage} drafted: ${findings.length} finding(s)` })
    const gate = stage === 1 ? 'GATE 1 (request + interpretation): present the owner\'s request next to your interpretation in plain words, then call mcp__orc__request_understanding' : 'GATE 2 (plan + rules): present the plan and the recommended rules with their alternatives in plain words, then call mcp__orc__request_permission'
    if (reopens) await note($, { kind: 'note', agentId: 'owner', text: 'redraft changed the mission or final picture approved at gate 1: gate 1 reopened' })
    return { result: (reopens ? 'NOTE: this redraft changes the mission or the final picture the owner approved at gate 1, so gate 1 is reopened: request it again before gate 2. ' : '') + (findings.length ? `orc: v${version} stage ${stage} stored at ${next.dir}/UNDERSTANDING.md with ${findings.length} finding(s) to fix before requesting:\n- ${findings.join('\n- ')}` : `orc: v${version} stage ${stage} stored at ${next.dir}/UNDERSTANDING.md; no findings. ${gate}.`) }
  })

  on('tool.call', { tool: 'mcp__orc__request_understanding' }, async ($, e) => {
    if ((e as unknown as { agentId?: string }).agentId) return { deny: 'orc request_understanding: main session only' }
    const m = await read($, missionState)
    if (!m || !m.understanding) return { deny: 'orc request_understanding: draft the understanding first (mcp__orc__draft_understanding)' }
    const f1 = validateUnderstanding(m.understanding, 1)
    if (f1.length) return { deny: `orc request_understanding: ${f1.length} gate-1 finding(s) remain: ${f1.join(' | ')}` }
    if (!['drafting', 'understanding_requested'].includes(m.status)) return { deny: `orc request_understanding: status is ${m.status}` }
    const at = await $.clock.now()
    const next: OrcMission = { ...m, status: 'understanding_requested', updatedAt: at }
    await update($, missionState, () => next); await persistMission($, next)
    openPane($)
    $.ui.toast('your approval is needed (gate 1: is this what you mean?)', { timeoutMs: 15000 })
    return { result: `orc: understanding v${m.version} presented to the owner in the /orc pane (Approve / Correct / Defer; or /orc approve, /orc correct <note>, /orc defer). Wait for the owner; their decision arrives as a prompt. Do not request again.` }
  })

  on('tool.call', { tool: 'mcp__orc__request_permission' }, async ($, e) => {
    if ((e as unknown as { agentId?: string }).agentId) return { deny: 'orc request_permission: main session only' }
    const m = await read($, missionState)
    if (!m || !m.understanding) return { deny: 'orc request_permission: no understanding' }
    if (!['understood', 'permission_requested'].includes(m.status)) return { deny: `orc request_permission: the understanding is not approved yet (status ${m.status}); gate 1 first` }
    const f2 = validateUnderstanding(m.understanding, 2)
    if (f2.length) return { deny: `orc request_permission: ${f2.length} gate-2 finding(s) remain (plan, team, policy, target, options): ${f2.join(' | ')}` }
    const at = await $.clock.now()
    const next: OrcMission = { ...m, status: 'permission_requested', updatedAt: at }
    await update($, missionState, () => next); await persistMission($, next)
    openPane($)
    $.ui.toast('your approval is needed (gate 2: the plan and its rules)', { timeoutMs: 15000 })
    const p = m.understanding.executionPolicy; const t = m.understanding.executionTarget
    return { result: `orc: plan & rules v${m.version} presented to the owner (gate 2): ${m.understanding.plan.nodes.length} nodes, ${p.maxAgents} agents max, ${p.maxAttemptsPerNode} attempts/node, ${p.maxDurationMinutes} min, effects ${p.allowedEffects.join(', ')}, paths ${t?.allowedPaths.join(' ') || '(whole repository)'}, repository ${m.repo}. Wait for the owner; approval starts the mission by itself.` }
  })

  on('tool.call', { tool: 'mcp__orc__resume' }, async ($, e) => {
    const input = e as unknown as { repo?: unknown; agentId?: string }
    if (input.agentId) return { deny: 'orc resume: main session only' }
    return { result: await resumeMission($, typeof input.repo === 'string' ? input.repo : undefined) }
  })
  on('tool.call', { tool: 'mcp__orc__directive' }, async ($, e) => {
    const input = e as unknown as { text?: unknown; agentId?: string }
    if (input.agentId) return { deny: 'orc directive: main session only' }
    if (typeof input.text !== 'string' || !input.text.trim()) return { deny: 'orc directive: text is required' }
    return { result: await addDirective($, input.text) }
  })
  on('tool.call', { tool: 'mcp__orc__continue' }, async ($, e) => {
    const input = e as unknown as { agentId?: string; request?: unknown }
    if (input.agentId) return { deny: 'orc continue: main session only' }
    return { result: await continueMission($, typeof input.request === 'string' ? input.request : '') }
  })

  on('tool.call', { tool: 'mcp__orc__backlog' }, async ($, e) => {
    const input = e as unknown as { action?: unknown; request?: unknown; agentId?: string }
    if (input.agentId) return { deny: 'orc backlog: main session only' }
    const action = input.action === 'add' || input.action === 'next' ? input.action : 'list'
    return { result: await backlogOp($, action, typeof input.request === 'string' ? input.request : undefined) }
  })

  on('tool.call', { tool: 'mcp__orc__demo' }, async ($, e) => {
    if (!LAB) return { deny: 'orc demo is a lab feature (config "lab": true)' }
    if ((e as unknown as { agentId?: string }).agentId) return { deny: 'orc demo: only the main session starts the demo' }
    const input = e as unknown as { name?: string; mode?: string; compactAt?: number }
    return { result: await startDemo($, { name: input.name, mode: input.mode === 'main' ? 'main' : undefined, compactAt: typeof input.compactAt === 'number' ? input.compactAt : undefined }) }
  })

  on('tool.call', { tool: 'mcp__orc__start' }, async ($, e) => {
    const input = e as unknown as { mission?: unknown; repo?: unknown; amendment?: unknown; final?: unknown; agentId?: string }
    if (input.agentId) return { deny: 'orc start: only the main session starts missions' }
    if (typeof input.mission !== 'string' || !input.mission.trim()) return { deny: 'orc start: mission (a file path) is required' }
    const text = await startMission($, { mission: input.mission.trim(), repo: typeof input.repo === 'string' ? input.repo : undefined, amendment: typeof input.amendment === 'string' ? input.amendment : undefined, final: typeof input.final === 'string' ? input.final : undefined, fresh: (input as { fresh?: unknown }).fresh === true, archive: (input as { archive?: unknown }).archive === true })
    return { result: text }
  })

  // ---- status: pull on demand (Track A, item 2) ------------------------------------
  on('tool.call', { tool: 'mcp__orc__status' }, async ($, e) => {
    if (!(e as unknown as { agentId?: string }).agentId) { try { await logAfterCompaction($, 'mcp__orc__status', 'status') } catch { /* best effort */ } }
    const input = e as unknown as { agentId?: string }
    const map = (await read($, agents)) ?? {}
    const orch = input.agentId ? map[input.agentId] : mainOrch(map)
    if (!orch || !isLedgerType(orch.type)) {
      const mm = await read($, missionState)
      if (!input.agentId && missionDoneHere(mm)) return { deny: `orc status: mission v${mm.version} in ${mm.repo} is finished. To continue it under orc call mcp__orc__continue {request} with the owner's words (no new gates); /orc backlog next starts a different goal. Never orchestrate by hand.` }
      return { deny: 'orc status: only an orchestrator (agent, or the main session while it runs an approved mission) may pull status' }
    }
    const now = await $.clock.now()
    const kids = kidsOf(map, orch).sort((a, b) => a.startedAt - b.startedAt)
    const running = kids.filter(a => a.status === 'running' || a.status === 'pending')
    const unmarked = kids.filter(a => a.status !== 'running' && a.status !== 'pending' && !a.mark)
    const runs = orch.integration?.runs ?? []
    const held = runs.filter(r => !r.reported)
    const lines = [
      `[orc status] ${iso(now)} · orchestrator ${orch.id.slice(0, 7)} · children ${kids.length} · running ${running.length}`,
      `unmarked returns: ${unmarked.length ? unmarked.map(a => `${a.id.slice(0, 7)} "${short(a.description, 30)}" (${a.checkResult ? 'check ' + a.checkResult.status : 'no check'})`).join('; ') : 'none'}`,
      `verification requests: ${(orch.verifyRequests ?? []).length}; without a report: ${(orch.verifyRequests ?? []).filter(v => !kids.some(k => k.type === (v.stage === 'integration' ? 'orc:integrator' : 'orc:verifier') && k.startedAt >= v.at - 2000 && k.status !== 'running')).map(v => v.stage).join(', ') || 'none'}`,
      `integration runs: ${runs.length} (last: ${runs.length ? `${runs[runs.length - 1]!.status.toUpperCase()} after merge of ${runs[runs.length - 1]!.after}, ${clock(now - runs[runs.length - 1]!.at)} ago` : 'none'})${held.length ? ` · held since your last wake: ${held.map(r => `${r.status.toUpperCase()} after ${short(r.after, 24)}`).join('; ')}` : ''}`,
      `last merges: ${kids.filter(k => k.worktree?.merged === 'merged').slice(-3).map(k => short(k.description, 24)).join(' → ') || 'none'}; conflicts so far: ${kids.filter(k => k.worktree?.merged === 'conflict').length}`,
      `running: ${running.map(a => `${a.id.slice(0, 7)} "${short(a.description, 24)}" (${ago(a.startedAt, now)})`).join(', ') || 'none'}`,
    ]
    const ib = ((await read($, inboxState)) ?? []).filter(i => !i.ackedAt)
    if (ib.length) lines.push(`inbox awaiting action: ${ib.map(i => `${i.id} ${i.kind}${i.spawn ? ` "${short(i.spawn.description, 30)}"` : ''} (delivered ${i.delivered.length}×)`).join('; ')}`)
    await markReported($, map, orch.id, now)
    await note($, { kind: 'note', agentId: orch.id, text: 'status pulled' })
    return { result: lines.join('\n') }
  })

  // ---- ledger: the mark tool ----------------------------------------------------

  on('tool.call', { tool: 'mcp__orc__run_graph' }, async ($, e) => {
    if ((e as unknown as { agentId?: string }).agentId) return { deny: 'orc run_graph: the main-session orchestrator runs graphs' }
    const brief = str((e as unknown as { brief?: unknown }).brief).trim()
    if (!brief) return { deny: 'orc run_graph: pass brief: "<path to the Workbench brief JSON>"' }
    return { result: await startGraph($, brief) }
  })

  on('tool.call', { tool: 'mcp__orc__graph_status' }, async ($, e) => {
    if ((e as unknown as { agentId?: string }).agentId) return { deny: 'orc graph_status: main session only' }
    const g = graphOf(await read($, missionState))
    return { result: g ? graphStatusText(g, await $.clock.now()) : 'orc graph_status: no graph run in this mission.' }
  })

  on('tool.call', { tool: 'mcp__orc__graph_decide' }, async ($, e) => {
    if ((e as unknown as { agentId?: string }).agentId) return { deny: 'orc graph_decide: main session only' }
    const i = e as unknown as { node?: unknown; action?: unknown; note?: unknown }
    return { result: await graphDecide($, str(i.node), str(i.action), str(i.note)) }
  })

  on('tool.call', { tool: 'mcp__orc__steer' }, async ($, e) => {
    const input = e as unknown as { taskId?: unknown; message?: unknown; agentId?: string }
    const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : ''
    const text = typeof input.message === 'string' ? input.message.trim() : ''
    if (!taskId || !text) return { deny: 'orc steer: give taskId and message' }
    if (text.length > 1500) return { deny: 'orc steer: keep the message under 1500 characters (one or two sentences)' }
    const map = (await read($, agents)) ?? {}
    const caller = input.agentId ? map[input.agentId] : mainOrch(map)
    if (!caller) return { deny: 'orc steer: only an orchestrator steers its children' }
    const hit = kidsOf(map, caller).find(a => a.id === taskId || (taskId.length >= 7 && a.id.startsWith(taskId)) || a.description === taskId)
    if (!hit) return { deny: `orc steer: no child "${short(taskId, 40)}" of yours` }
    const at = await $.clock.now()
    const live = (await $.agent.list()).find(x => x.id === hit.id)?.status
    if (live === 'running' || live === 'pending') {
      await patchAgent($, hit.id, a => ({ ...a, steers: [...(a.steers ?? []), { at, text }].slice(-10) }))
      await note($, { kind: 'send', agentId: hit.id, text: `steer queued: ${short(text, 60)}` })
      return { result: `orc steer: queued for ${hit.id.slice(0, 7)} "${short(hit.description, 40)}"; it reads it with its next tool result. If it finishes first, your next wake says so.` }
    }
    const sent = await $.session.send({ to: { agentId: hit.id }, text: `[orc · steer from the orchestrator] ${text}\nAct on this within your task, then report again in your report shape.` })
    if (!sent.isDelivered) return { deny: `orc steer: ${hit.id.slice(0, 7)} could not be resumed: ${sent.reason}` }
    await patchAgent($, hit.id, a => ({ ...a, status: 'running', steers: [...(a.steers ?? []), { at, text, deliveredAt: at, via: 'resume' as const }].slice(-10) }))
    await note($, { kind: 'send', agentId: hit.id, text: `steer resumed it: ${short(text, 60)}` })
    return { result: `orc steer: ${hit.id.slice(0, 7)} "${short(hit.description, 40)}" had finished; it was resumed with your message, its context intact. Its new report arrives as a wake; mark that one.` }
  })

  on('tool.call', { tool: 'mcp__orc__mark' }, async ($, e) => {
    if (!(e as unknown as { agentId?: string }).agentId) { try { await logAfterCompaction($, 'mcp__orc__mark', `${String((e as unknown as { taskId?: unknown }).taskId ?? '')} ${String((e as unknown as { verdict?: unknown }).verdict ?? '')}`) } catch { /* best effort */ } }
    const input = e as unknown as { taskId?: unknown; verdict?: unknown; note?: unknown; agentId?: string }
    const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : ''
    const verdict = typeof input.verdict === 'string' ? input.verdict : ''
    const noteText = typeof input.note === 'string' ? input.note.trim() : ''
    if (!['accepted', 'rejected', 'redo'].includes(verdict)) return { deny: 'orc mark: verdict must be accepted | rejected | redo' }
    const map = (await read($, agents)) ?? {}
    const caller = input.agentId ? map[input.agentId] : mainOrch(map)
    const mine = caller ? kidsOf(map, caller) : Object.values(map)
    let hit = mine.find(a => a.id === taskId || (taskId.length >= 7 && a.id.startsWith(taskId)) || a.description === taskId)
    // Adoption (mission 3, B7): an orchestrator may mark a child of an orchestrator that is no longer running.
    if (!hit && caller && caller.type.startsWith('orc:orchestrator')) {
      const live = await $.agent.list()
      const orphan = Object.values(map).find(a => a.parentId && a.parentId !== caller.id && (a.id === taskId || (taskId.length >= 7 && a.id.startsWith(taskId)) || a.description === taskId))
      const parentLive = orphan ? live.find(x => x.id === orphan.parentId)?.status : undefined
      if (orphan && !(parentLive === 'running' || parentLive === 'pending')) hit = orphan
    }
    if (!hit) return { deny: `orc mark: no child matches "${taskId}" (ids: ${mine.map(a => a.id.slice(0, 7) + ' "' + short(a.description, 24) + '"').join(', ')})` }
    if (hit.status === 'running' || hit.status === 'pending') return { deny: `orc mark: ${hit.id.slice(0, 7)} is still running; mark it after it returns` }
    const at = await $.clock.now()
    await patchAgent($, hit.id, a => ({ ...a, mark: { verdict: verdict as 'accepted' | 'rejected' | 'redo', note: short(noteText, 300), at, by: caller && caller.id !== hit.parentId ? caller.id : undefined } }))
    await note($, { kind: 'note', agentId: hit.id, text: `mark ${verdict}: ${short(noteText, 60)}` })
    // The projection must reflect every state change, not only wakes (mission 3, B7): rewrite it now.
    if (hit.parentId) {
      try { await $.fs.write(`${OUT_DIR}/ledger/${hit.parentId.slice(0, 7)}.md`, fullLedger((await read($, agents)) ?? {}, hit.parentId, at)) } catch { /* best effort */ }
    }
    let text = `marked ${hit.id.slice(0, 7)} "${short(hit.description, 40)}" as ${verdict} at ${new Date(at).toISOString()}`
    if (verdict === 'accepted' && hit.worktree && !hit.worktree.merged) {
      const res = await mergeClone($, hit.worktree)
      await patchAgent($, hit.id, a => ({ ...a, worktree: a.worktree ? { ...a.worktree, merged: res.merged, mergeNote: res.note } : a.worktree }))
      await note($, { kind: 'note', agentId: hit.id, text: `merge ${res.merged}: ${short(res.note, 60)}` })
      text += res.merged === 'merged' ? ` · MERGED ${hit.worktree.branch} into ${hit.worktree.base} (${res.note})` : res.merged === 'nothing' ? ` · NOTHING TO MERGE: ${res.note}` : ` · MERGE ${res.merged.toUpperCase()}: ${res.note}`
      // Pruning: a merged (or empty) clone has nothing left to give; a conflict keeps its checkout for inspection.
      if (res.merged === 'merged' || res.merged === 'nothing') {
        const pr = await pruneWorktree($, hit.worktree.base, hit.worktree.path)
        await patchAgent($, hit.id, a => ({ ...a, worktree: a.worktree ? { ...a.worktree, pruned: pr === 'removed' } : a.worktree }))
        text += ` · clone ${pr} (branch ${hit.worktree.branch} kept)`
      }
      if (res.merged === 'merged' && caller && isIntegType(caller.type)) {
        const base = hit.worktree.base
        await patchAgent($, caller.id, a => ({ ...a, integration: { repo: base, due: { after: hit.description, branch: hit.worktree?.branch ?? '', at }, runs: a.integration?.runs ?? [], dispatches: a.integration?.dispatches ?? [] } }))
        text += ' · the integration check runs on the merged HEAD now: a FAIL wakes you at once; a PASS rides your next wake, or wakes you if nothing else is running'
      }
    }
    if (verdict === 'rejected' && hit.worktree && !hit.worktree.merged && !hit.worktree.pruned) {
      const pr = await pruneWorktree($, hit.worktree.base, hit.worktree.path)
      await patchAgent($, hit.id, a => ({ ...a, worktree: a.worktree ? { ...a.worktree, pruned: pr === 'removed' } : a.worktree }))
      text += ` · clone ${pr} (branch ${hit.worktree.branch} kept)`
    }
    // A marked verifier's snapshot is done with: remove the detached checkout it was pointed at.
    if (baseType(hit.type) === 'orc:verifier' && hit.parentId && !hit.description.startsWith('graph ')) {
      const parent = map[hit.parentId]
      // The request this verifier answers is the LATEST one made before it started (an earlier, voided request must not match).
      const req = (parent?.verifyRequests ?? []).filter(v => v.snapshot && !v.pruned && v.stage !== 'integration' && v.at <= hit.startedAt + 2000).sort((a, b) => b.at - a.at)[0]
      if (req?.snapshot) {
        const pr = await pruneWorktree($, req.repo, req.snapshot)
        await patchAgent($, hit.parentId, a => ({ ...a, verifyRequests: (a.verifyRequests ?? []).map(v => v.id === req.id ? { ...v, pruned: pr === 'removed' } : v) }))
        text += ` · snapshot ${pr}`
      }
    }
    return { result: text }
  })

  // ---- tools ------------------------------------------------------------------

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const mapB = (await read($, agents)) ?? {}
      const callerRow = mapB[e.agentId]
      const argsB = argsOf(e as unknown as Record<string, unknown>)
      if (callerRow?.boundary) {
        const v = boundaryCheck(e.tool, argsB, callerRow.boundary)
        if (v) {
          const at = await $.clock.now()
          await patchAgent($, callerRow.id, a => ({ ...a, denied: [...(a.denied ?? []), { tool: e.tool, target: v.target, reason: v.reason, at }].slice(-50) }))
          await note($, { kind: 'tool', agentId: callerRow.id, text: `boundary denied ${e.tool} → ${short(v.target, 50)}` })
          return { deny: v.reason }
        }
        if (e.tool === 'Bash') {
          const sus = shellSuspect(argsB, callerRow.boundary)
          if (sus) {
            const at = await $.clock.now()
            await patchAgent($, callerRow.id, a => ({ ...a, suspects: [...(a.suspects ?? []), { tool: e.tool, target: sus.target, reason: sus.reason, at }].slice(-50) }))
          }
        }
      } else if (callerRow && isBoundType(callerRow.type) && e.tool === 'Bash') {
        const reason = orchestratorCommitCheck(argsB)
        if (reason) {
          const at = await $.clock.now()
          await patchAgent($, callerRow.id, a => ({ ...a, denied: [...(a.denied ?? []), { tool: e.tool, target: 'git sweep', reason, at }].slice(-50) }))
          await note($, { kind: 'tool', agentId: callerRow.id, text: 'boundary denied orchestrator git sweep' })
          return { deny: reason }
        }
      }
    }
    if (!e.agentId) {
      const mapL = (await read($, agents)) ?? {}
      const live = Object.values(mapL).filter(a => a.type.startsWith('orc:orchestrator') && (a.status === 'running' || a.status === 'pending'))
      if (live.length) {
        const mis = await read($, missionState)
        const v = mis?.editUnlocked ? undefined : modEditViolation(e.tool, argsOf(e as unknown as Record<string, unknown>))
        if (v) {
          await note($, { kind: 'tool', agentId: MAIN_ORCH, text: `edit lock denied: ${short(v, 60)}` })
          return { deny: `orc EDIT LOCK: a mission is running (${live.map(a => short(a.description, 40)).join('; ')}); ${v} would hot-reload the plugin mid-mission and drop in-flight state. Finish or settle the mission first. The owner can override for this mission by typing /orc allow-edit (there is no tool for it).` }
        }
      }
    }
    if (!e.agentId && e.tool === 'Bash') {
      const mapM = (await read($, agents)) ?? {}
      if (mainOrch(mapM)) {
        const reason = orchestratorCommitCheck(argsOf(e as unknown as Record<string, unknown>))
        if (reason) {
          await note($, { kind: 'tool', agentId: MAIN_ORCH, text: 'boundary denied orchestrator git sweep (main session)' })
          return { deny: reason }
        }
      }
    }
    const t0 = await $.clock.now()
    const ran = await next(e)
    const ms = (await $.clock.now()) - t0
    const failed = ran.deny !== undefined || ran.isError === true
    const args = argsOf(e as unknown as Record<string, unknown>)
    const { cls, what } = classify(e.tool, args)
    const act = activityOf(e.tool, cls, args)
    const sent = sizeOf(args)
    const got = ran.deny !== undefined ? ran.deny.length : typeof ran.text === 'string' ? ran.text.length : sizeOf(ran.result)
    const add = (b0: OrcBucket | undefined): OrcBucket => {
      const b = { ...(b0 ?? emptyBucket()) }
      b.count += 1
      b.ms += ms
      b.inBytes += got
      b.outBytes += sent
      b.failed += failed ? 1 : 0
      return b
    }
    if (e.agentId) {
      await patchAgent($, e.agentId, a => ({
        ...a,
        toolCalls: a.toolCalls + 1,
        toolErrors: a.toolErrors + (failed ? 1 : 0),
        lastTool: e.tool,
        lastProgressAt: Date.now(),
        classes: { ...(a.classes ?? {}), [cls]: add(a.classes?.[cls]) },
        activities: { ...(a.activities ?? {}), [act]: add(a.activities?.[act]) },
        tools: [...(a.tools ?? []), { tool: e.tool, cls, act, ms, inBytes: got, outBytes: sent, what: short(what, 80) }].slice(-400),
      }))
      if (failed) await note($, { kind: 'tool', agentId: e.agentId, text: `${e.tool} failed${ran.deny ? ` (denied: ${short(ran.deny, 50)})` : ''}` })
      if (ran.deny === undefined) {
        const waiting = (((await read($, agents)) ?? {})[e.agentId]?.steers ?? []).filter(x => !x.deliveredAt)
        if (waiting.length) {
          const atD = await $.clock.now()
          await patchAgent($, e.agentId, a => ({ ...a, steers: (a.steers ?? []).map(x => (x.deliveredAt ? x : { ...x, deliveredAt: atD, via: 'tool-result' as const })) }))
          await note($, { kind: 'send', agentId: e.agentId, text: `steer read with ${e.tool}'s result` })
          return { ...ran, context: [...(ran.context ?? []), ...waiting.map(x => `[orc · steer from the orchestrator] ${x.text}\n(Follow it within your task; it does not change what you may change or your report shape.)`)] } as typeof ran
        }
      }
      return ran
    }
    await patchCur($, t => ({
      ...t,
      classes: { ...t.classes, [cls]: add(t.classes[cls]) },
      activities: { ...(t.activities ?? {}), [act]: add(t.activities?.[act]) },
      tools: [...t.tools, { tool: e.tool, cls, act, ms, inBytes: got, outBytes: sent, what: short(what, 80) }],
    }))
    {
      const mc = await read($, missionState)
      const lastC = mc?.compactions?.slice(-1)[0]
      if (mainMissionLive(mc) && lastC?.compactedAt && lastC.after.length < 12) {
        const atT = await $.clock.now()
        await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(c => (c.at === lastC.at ? { ...c, after: [...c.after, { at: atT, tool: e.tool, what: short(what, 90) }], statusCalledAt: c.statusCalledAt ?? (e.tool === 'mcp__orc__status' ? atT : undefined) } : c)) }))
      }
    }
    if (mainOrch((await read($, agents)) ?? {})) {
      await patchAgent($, MAIN_ORCH, a => ({ ...a, toolCalls: a.toolCalls + 1, toolErrors: a.toolErrors + (failed ? 1 : 0), lastTool: e.tool, lastProgressAt: Date.now(), classes: { ...(a.classes ?? {}), [cls]: add(a.classes?.[cls]) }, activities: { ...(a.activities ?? {}), [act]: add(a.activities?.[act]) }, tools: [...(a.tools ?? []), { tool: e.tool, cls, act, ms, inBytes: got, outBytes: sent, what: short(what, 80) }].slice(-400) }))
    }
    // The inbox's busy door: a main turn is open, so due items ride this tool result as context the model reads next.
    if (ran.deny === undefined) {
      try {
        const block = await inboxContextFor($)
        if (block) return { ...ran, context: [...(ran.context ?? []), block] } as typeof ran
      } catch (err) {
        $.ui.log(`orc: inbox context attach failed: ${String(err)}`, { to: 'debug' })
      }
    }
    return ran
  })

  // ---- subagents ----------------------------------------------------------------

  on('agent.spawn', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const map0 = (await read($, agents)) ?? {}
    const forId = /\[for (main|[0-9a-f]{7,})\]/.exec(e.description)?.[1]
    const linkedParent = !e.parentAgentId && forId ? Object.values(map0).find(a => a.id.startsWith(forId) && isLedgerType(a.type)) : undefined
    // Packet 2: an orc:* child spawned by the main session while it is the orchestrator belongs to the main row.
    const mainParent = !e.parentAgentId && !linkedParent && e.subagentType.startsWith('orc:') && e.subagentType !== 'orc:orchestrator' ? mainOrch(map0) : undefined
    const parent = e.parentAgentId ? map0[e.parentAgentId] : linkedParent ?? mainParent
    if (e.subagentType.endsWith('-web')) {
      const role = baseType(e.subagentType).replace(/^orc:/, '')
      if (!browserGranted(await read($, missionState), role)) {
        await note($, { kind: 'spawn', text: `spawn refused: ${e.subagentType} without a browser granted to ${role}s at gate 2` })
        return { deny: `orc: the approved plan grants no browser to ${role}s. Spawn ${baseType(e.subagentType)} instead, or ask the owner to correct gate 2 (a capability with a browser, by: ${role}).` }
      }
    }
    if (mainParent && baseType(e.subagentType) === 'orc:builder') {
      const mis = await read($, missionState)
      const cap = mis?.lab?.maxAgents ?? mis?.understanding?.executionPolicy.maxAgents ?? 3
      const live = kidsOf(map0, mainParent).filter(a => baseType(a.type) === 'orc:builder' && (a.status === 'running' || a.status === 'pending')).length
      if (live >= cap) {
        await note($, { kind: 'spawn', text: `spawn refused: ${live} builders live, owner limit ${cap}` })
        return { deny: `orc: the owner-approved limit is ${cap} builders at a time and ${live} are running; wait for a return (the wake) before dispatching more.` }
      }
    }
    const isLab = e.subagentType.startsWith('orc:') || parent?.type.startsWith('orc:') === true
    let preflight: { ok: boolean; hard: string[]; soft: string[] } | undefined
    let cloneInfo: { path: string; branch: string; base: string } | undefined
    let promptOut = e.prompt
    if (parent && isBoundType(parent.type) && isCheckedChild(e.subagentType)) {
      const cmd0 = /^CHECK:\s*(.+)$/m.exec(e.prompt)?.[1]?.trim()
      const cwd0 = /^CHECK_CWD:\s*(.+)$/m.exec(e.prompt)?.[1]?.trim()
      const may0 = /^MAY_CHANGE:\s*(.+)$/m.exec(e.prompt)?.[1]?.trim()
      const base0 = cwd0 && cwd0.startsWith('/') ? cwd0 : DEFAULT_REPO
      let root0 = base0
      if (isFaninType(parent.type) && baseType(e.subagentType) === 'orc:builder') {
        const made = await makeClone($, base0, e.description)
        if (made) {
          root0 = made.path
          cloneInfo = { path: made.path, branch: made.branch, base: base0 }
        }
      }
      const b0 = may0 ? { root: root0, allow: may0.split(/[\s,]+/).filter(Boolean).map(x => x.replace(/^\.\//, '').replace(/\/+$/, '')) } : undefined
      const sibs0 = Object.values(map0).filter(a => a.parentId === parent.id)
      preflight = await dispatchPreflight($, e.prompt, b0, cmd0 ? { command: cmd0, cwd: root0 } : undefined, sibs0)
      const lines = [...preflight.hard.map(h => `HARD: ${h}`), ...preflight.soft.map(x => `note: ${x}`)]
      let p2 = e.prompt
      if (cloneInfo) {
        p2 = p2.replace(/^CHECK_CWD:\s*.+$/m, `CHECK_CWD: ${cloneInfo.path}`)
        p2 += `\n\n[substrate clone] You work in your own clone of the repository: ${cloneInfo.path} (branch ${cloneInfo.branch}, cut from ${cloneInfo.base} at dispatch). Do ALL reading, editing, testing and committing there; never touch ${cloneInfo.base}. Commit your finished work on this branch, staging paths by name; the orchestrator merges it on acceptance. Your work order file is in the repository's ops/ and is also present in the clone.`
      }
      if (lines.length) p2 = `${p2}\n\n[substrate preflight] ${preflight.ok ? 'launch is clean apart from the notes below' : 'launch has hard findings; proceed, but report them'}:\n${lines.join('\n')}`
      promptOut = p2
      if (!preflight.ok) {
        try {
          await notifyOrch($, parent.id, `[orc preflight] dispatch "${e.description}" has hard findings (the builder was still launched and told): ${preflight.hard.join('; ')}`)
        } catch {
          /* best effort */
        }
      }
    }
    let spawnArgs = promptOut === e.prompt ? e : { ...e, prompt: promptOut }
    // The owner approved a worker model at gate 2: every orc child of the main-session mission runs on it.
    if (mainParent && e.subagentType.startsWith('orc:')) {
      const approved = approvedWorkerModel((await read($, missionState))?.understanding?.executionPolicy?.model)
      if (approved) spawnArgs = { ...spawnArgs, model: approved }
    }
    const ran = isLab && LAB_MODEL && !e.subagentType.startsWith('orc:') ? await next({ ...spawnArgs, model: LAB_MODEL }) : await next(spawnArgs)
    if (parent) await patchAgent($, parent.id, a => ({ ...a, children: a.children + 1 }))
    if (ran.deny !== undefined || ran.agentId === undefined) {
      await note($, { kind: 'spawn', text: `spawn refused (${e.subagentType}): ${ran.deny ?? 'no id'}` })
      return ran
    }
    const row: OrcAgent = {
      id: ran.agentId,
      type: e.subagentType,
      description: e.description,
      model: ran.model ?? e.model,
      status: 'running',
      startedAt,
      toolCalls: 0,
      toolErrors: 0,
      promptChars: e.prompt.length,
      steps: 0,
      modelMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      parentId: e.parentAgentId ?? linkedParent?.id ?? mainParent?.id,
      classes: {},
      activities: {},
      tools: [],
      outProseChars: 0,
      outThinkChars: 0,
      outArgChars: 0,
      ctxTokens: 0,
      ctxMax: 0,
      ctxFirst: 0,
      children: 0,
      runs: 0,
    }
    if (parent && isChecksType(parent.type)) {
      const cmd = /^CHECK:\s*(.+)$/m.exec(promptOut)?.[1]?.trim()
      const cwd = /^CHECK_CWD:\s*(.+)$/m.exec(promptOut)?.[1]?.trim()
      const tmo = /^CHECK_TIMEOUT:\s*(\d+)\s*(s|m|min|sec)?\s*$/m.exec(promptOut)
      const timeoutMs = tmo ? parseInt(tmo[1]!, 10) * (/^m/.test(tmo[2] ?? 's') ? 60000 : 1000) : undefined
      if (cmd) row.check = { command: cmd, cwd: cwd && cwd.startsWith('/') ? cwd : DEFAULT_REPO, ...(timeoutMs ? { timeoutMs } : {}) }
      if (cloneInfo) row.worktree = cloneInfo
      if (isBoundType(parent.type) && isCheckedChild(e.subagentType)) {
        const may = /^MAY_CHANGE:\s*(.+)$/m.exec(e.prompt)?.[1]?.trim()
        const root = row.check?.cwd ?? (cwd && cwd.startsWith('/') ? cwd : DEFAULT_REPO)
        if (may) row.boundary = { root, allow: may.split(/[\s,]+/).filter(Boolean).map(x => x.replace(/^\.\//, '').replace(/\/+$/, '')) }
        if (preflight) row.preflight = { ...preflight, at: startedAt }
      }
    }
    await update($, agents, map => ({ ...(map ?? {}), [row.id]: row }))
    if (!e.parentAgentId && !linkedParent && !mainParent) await patchCur($, t => ({ ...t, spawned: [...t.spawned, row.id] }))
    if (e.subagentType.startsWith('orc:')) await inboxAck($, i => !!i.spawn && i.spawn.type === e.subagentType && i.spawn.description === e.description, row.id)
    if (mainParent) {
      const mc = await read($, missionState)
      const lastC = mc?.compactions?.slice(-1)[0]
      if (mainMissionLive(mc) && lastC?.compactedAt && lastC.spawns.length < 30) {
        const dup = kidsOf(map0, mainParent).find(k => k.id !== row.id && k.description === e.description && (k.status === 'running' || k.status === 'pending' || k.worktree?.merged === 'merged'))
        const atS = await $.clock.now()
        await patchMission($, x => ({ ...x, compactions: (x.compactions ?? []).map(c => (c.at === lastC.at ? { ...c, spawns: [...c.spawns, { at: atS, type: e.subagentType, description: short(e.description, 80), duplicateOf: dup ? dup.id.slice(0, 7) : undefined }] } : c)) }))
      }
    }
    await note($, { kind: 'spawn', agentId: row.id, text: `spawn ${e.subagentType}${row.model ? ` (${row.model})` : ''}: ${short(e.description, 60)} · prompt ${k(e.prompt.length)} chars` })
    return ran
  })

  on('session.send', async ($, e, next) => {
    await note($, { kind: 'send', agentId: e.agentId, text: `→ ${e.to}: ${short(flat(e.text), 60)}` })
    // Owner-directive preflight (Track A, item 3): the same mechanical checks a builder dispatch gets, run on an
    // owner directive before the orchestrator reads it; findings are appended, never blocking.
    if (/^\s*Owner directive/i.test(e.text)) {
      const map = (await read($, agents)) ?? {}
      const orch = Object.values(map).find(a => isLedgerType(a.type) && (a.id === e.to || a.id.startsWith(e.to) || e.to.startsWith(a.id.slice(0, 7))))
      if (orch) {
        const repo = orch.integration?.repo ?? [...new Set(Object.values(map).filter(a => a.parentId === orch.id && a.check?.cwd).map(a => a.worktree ? a.check!.cwd.replace(a.worktree.path, a.worktree.base) : a.check!.cwd))][0]
        const findings: string[] = []
        for (const m of e.text.matchAll(/MAY_CHANGE:\s*([^\n]+)/g)) {
          // Only path-like tokens count, and the list ends at the first token that closes a sentence (prose follows in
          // owner directives, unlike builder prompts where the line is the whole list).
          const toks: string[] = []
          for (const raw of m[1]!.trim().split(/\s+/)) {
            const tok = raw.replace(/[,;]+$/, '')
            const closes = /\.$/.test(tok) && !/\.[A-Za-z0-9_]+$/.test(tok.replace(/\.$/, '')) ? true : /\.$/.test(tok)
            const clean = tok.replace(/\.$/, '')
            if (!/[\/.]/.test(clean) || /^[A-Z][a-z]+$/.test(clean)) break
            toks.push(clean)
            if (closes) break
          }
          for (const entry of toks) {
            if (entry.startsWith('/')) findings.push(`MAY_CHANGE entry is absolute, not repo-relative: ${entry}`)
            else if (repo && !(await $.fs.exists(`${repo}/${entry}`)) && !(await $.fs.exists(`${repo}/${entry.replace(/\/[^/]+$/, '')}`))) findings.push(`MAY_CHANGE entry has no existing path or parent in the repository: ${entry}`)
          }
        }
        for (const m of e.text.matchAll(/CHECK:\s*([^\n]+)/g)) {
          const cmd = m[1]!.trim().split(/\.\s+[A-Z]/)[0]!
          const first = cmd.split(/\s+/)[0] ?? ''
          try {
            const w = await $.process.run(['/bin/sh', '-c', `command -v ${JSON.stringify(first)}`], { timeoutMs: 5000 })
            if (w.exitCode !== 0) findings.push(`CHECK's first command is not on PATH: ${first}`)
          } catch { /* ignore */ }
          if (/^python3? -c ["']import /.test(cmd)) findings.push(`CHECK only imports a module; it proves nothing about behaviour: ${short(cmd, 60)}`)
        }
        for (const m of e.text.matchAll(/(\/Users\/[^\s"'`,;)]+)/g)) {
          const pth = m[1]!.replace(/[.:]+$/, '')
          if (!(await $.fs.exists(pth))) findings.push(`path named in the directive does not exist: ${pth}`)
        }
        const files = [...e.text.matchAll(/(\/Users\/[^\s"'`,;)]+\.jsonl)/g)].map(x => x[1]!)
        for (const m of e.text.matchAll(/at least (\d+) distinct ([`\w ]+?) (?:names? )?(?:appear|exist|occur)/gi)) findings.push(`threshold "at least ${m[1]} distinct ${m[2]!.trim()}" is stated without naming how it was checked against ${files.length ? files.join(', ') : 'the data'}; verify before dispatching`)
        if (findings.length) {
          await note($, { kind: 'note', agentId: orch.id, text: `directive preflight: ${findings.length} finding(s)` })
          return next({ ...e, text: `${e.text}\n\n[substrate preflight of this directive] ${findings.length} finding(s):\n${findings.map(f => `- ${f}`).join('\n')}` })
        }
        await note($, { kind: 'note', agentId: orch.id, text: 'directive preflight: clean' })
      }
    }
    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    await note($, { kind: 'receive', agentId: e.agentId, text: `← ${e.origin.kind}: ${short(flat(e.text), 60)}` })
    return next(e)
  })

  // ---- command ------------------------------------------------------------------

  on('command.run', { command: 'orc' }, async ($, e) => {
    const argv = (e.args ?? '').trim()
    if (/^start\s+/.test(argv)) {
      const parts = argv.replace(/^start\s+/, '').split(/\s+/).filter(Boolean)
      const kv: Record<string, string> = {}
      const mission = parts.filter(x => !x.includes('='))[0] ?? ''
      for (const x of parts.filter(x => x.includes('='))) { const [k, v] = x.split('=', 2); kv[k!] = v ?? '' }
      const text = mission ? await startMission($, { mission, repo: kv.repo, amendment: kv.amendment, final: kv.final, fresh: kv.fresh === '1' || kv.fresh === 'true', archive: kv.archive === '1' || kv.archive === 'true', mode: kv.mode === 'main' ? 'main' : undefined, auto: kv.auto === '1' || kv.auto === 'true', compactAt: /^\d+k?$/i.test(kv.compact ?? '') ? Number(kv.compact!.replace(/k$/i, '')) * (/k$/i.test(kv.compact!) ? 1000 : 1) : undefined, maxAgents: /^\d+$/.test(kv.agents ?? '') ? Number(kv.agents) : undefined }) : 'orc start: usage: /orc start <mission.md> [repo=<path>] [amendment=<path>] [final=<path>] [archive=1] [fresh=1]'
      return { text }
    }
    if (/^policy\b/.test(argv)) {
      const m = await read($, missionState)
      if (!m?.graph) return { text: 'orc policy: no graph run in the current mission (policy lives in the brief until a run starts).' }
      const kv: Record<string, string> = {}
      for (const x of argv.replace(/^policy\s*/, '').split(/\s+/).filter(y => y.includes('='))) { const [kk, v] = x.split('=', 2); kv[kk!] = v ?? '' }
      if (!Object.keys(kv).length) return { text: `orc policy: retry=${m.graph.policy.retryBudget} parallel=${m.graph.policy.maxParallel} ping=${m.graph.policy.ping} (change with /orc policy retry=N parallel=N ping=every_node|failures_only|phase_end; applies to what has not started)` }
      const cap = m.lab?.maxAgents ?? m.understanding?.executionPolicy?.maxAgents ?? 3
      const pol = { ...m.graph.policy }
      if (/^\d+$/.test(kv.retry ?? '')) pol.retryBudget = Number(kv.retry)
      if (/^\d+$/.test(kv.parallel ?? '')) pol.maxParallel = Math.max(1, Math.min(cap, Number(kv.parallel)))
      if (['every_node', 'failures_only', 'phase_end'].includes(kv.ping ?? '')) pol.ping = kv.ping as typeof pol.ping
      await patchGraph($, g => ({ ...g, policy: pol }))
      await note($, { kind: 'note', agentId: 'owner', text: `graph policy changed: retry ${pol.retryBudget}, parallel ${pol.maxParallel}, ping ${pol.ping}` })
      await graphPump($)
      return { text: `orc policy: now retry=${pol.retryBudget} parallel=${pol.maxParallel} ping=${pol.ping} (the owner limit caps parallel at ${cap}); it applies to nodes and retries that have not started.` }
    }
    if (/^demo\b/.test(argv)) {
      if (!LAB) return { text: 'orc demo is a lab feature: set "lab": true in ~/.claude/orc/config.json to use it.' }
      const kv: Record<string, string> = {}
      for (const x of argv.replace(/^demo\s*/, '').split(/\s+/).filter(y => y.includes('='))) { const [kk, v] = x.split('=', 2); kv[kk!] = v ?? '' }
      const num = (v?: string) => { const mm = /^(\d+(?:\.\d+)?)(k)?$/i.exec(v ?? ''); return mm ? Math.round(Number(mm[1]) * (mm[2] ? 1000 : 1)) : undefined }
      return { text: await startDemo($, { name: kv.name, mode: kv.mode === 'main' ? 'main' : undefined, compactAt: num(kv.compact) }) }
    }
    if (/^begin\b/.test(argv)) {
      const rest = argv.replace(/^begin\s*/, '')
      const repoArg = /(?:^|\s)repo=(\S+)/.exec(rest)?.[1]
      const request = rest.replace(/(?:^|\s)repo=\S+/, '').replace(/(?:^|\s)mode=\S+/, '').trim()
      if (!request) {
        await inboxPush($, { kind: 'notice', text: 'orc intake (automatic): the owner typed /orc begin without a request. Ask them, in plain words, what they want built and which folder it should live in (a project folder, never their home folder; an empty one is fine). Then call mcp__orc__owner_context with repo set to that folder and interview them as its contract says.' })
        return { text: 'orc: tell the session what you want built, in your own words, and which folder it belongs in. It will interview you, then ask you to approve its understanding and its plan before anything runs.' }
      }
      const repo = await repoOf($, repoArg)
      if (isHomeOrRoot(repo)) return { text: `orc begin: ${repo} is your home folder, which orc will not use as a project (it runs git init there). Name a folder: /orc begin repo=~/projects/<name> ${short(request, 60)}` }
      const at = await $.clock.now()
      const prev = await read($, missionState)
      const version = prev && prev.repo === repo ? prev.version + 1 : 1
      const seed: OrcUnderstanding = { mission: { statement: '', deliverables: [] }, finalPicture: { summary: '', criteria: [], constraints: [], exclusions: [] }, plan: { nodes: [] }, team: { roles: [] }, executionPolicy: { model: 'inherit', maxAgents: 3, maxAttemptsPerNode: 2, maxDurationMinutes: 120, allowedEffects: ['local_read', 'local_write'], materialChangeRule: '' }, executionTarget: { kind: 'git_repository', repositoryPath: repo, allowedPaths: [] }, sourceEvidence: { originalRequest: request, items: [{ id: 'e1', text: request, classification: 'supplied', role: 'context', source: 'owner, /orc begin' }], coverage: [] }, openQuestions: [] }
      const mode = /(?:^|\s)mode=subagent(?:\s|$)/.test(rest) ? 'subagent' : 'main'
      const next: OrcMission = { repo, dir: missionDir(repo), version, status: 'drafting', mode, understanding: seed, findings: ['(seed only: draft the package)'], decisions: [], updatedAt: at }
      await update($, missionState, () => next); await persistMission($, next)
      await inboxPush($, { kind: 'notice', text: `orc intake (automatic): the owner opened intake v${version} for ${repo} with /orc begin; their request and the drafting contract are in the command output above. Start the interview now: restate the request, say what you are unsure about, and ask your first question.` })
      return { text: `orc: intake v${version} opened for ${repo} (orchestrator: ${mode === 'main' ? 'this session' : 'a subagent'}). Original request recorded.\n\n${await ownerContext($, repo)}\n\nNow interview the owner: ask only material questions, then draft with mcp__orc__draft_understanding.` }
    }
    if (/^(approve|correct|defer)\b/.test(argv)) {
      const choice = /^(approve|correct|defer)/.exec(argv)![1] as 'approve' | 'correct' | 'defer'
      const noteText = argv.replace(/^(approve|correct|defer)\s*/, '').trim()
      const m = await read($, missionState)
      const gate = m?.status === 'permission_requested' ? 'permission' : 'understanding'
      if (choice === 'correct' && !noteText) return { text: 'orc correct: say what to change: /orc correct <note>' }
      return { text: await recordDecision($, gate, choice, noteText) }
    }
    if (/^(allow-edit|lock-edit)\b/.test(argv)) {
      const unlock = /^allow-edit/.test(argv)
      const m = await read($, missionState)
      if (!m) return { text: 'orc: no mission in this session; the edit lock only applies while a mission runs.' }
      const next: OrcMission = { ...m, editUnlocked: unlock, updatedAt: await $.clock.now() }
      await update($, missionState, () => next); await persistMission($, next)
      await note($, { kind: 'note', agentId: 'owner', text: unlock ? 'edit lock OVERRIDDEN by the owner' : 'edit lock restored' })
      return { text: unlock ? `orc: edit lock overridden for mission v${m.version} by the owner; plugin edits are allowed until the mission settles or /orc lock-edit.` : `orc: edit lock restored for mission v${m.version}.` }
    }
    if (/^computer\b/.test(argv)) {
      const sub = argv.replace(/^computer\s*/, '').trim()
      if (sub === 'on' || sub === 'off') return { text: await computerSwitch($, sub === 'on') }
      const m = await read($, missionState)
      const repo = m?.repo ?? (await repoOf($, undefined))
      const st = await sandboxStatus($, repo)
      return { text: `orc computer for ${repo}:\n${m ? computerLine(m, st) : `computer: no mission yet · sandbox ${sandboxWords(st)}`}\nThe computer: writes only to the repository and orc's clones; no network except hosts the plan names; a headless browser of its own, given only to the roles gate 2 granted.\n/orc computer on writes the sandbox settings for this repository (a restart steps inside); /orc computer off removes them.` }
    }
    if (/^resume\b/.test(argv)) return { text: await resumeMission($, argv.replace(/^resume\s*/, '').trim() || undefined) }
    if (/^directive\b/.test(argv)) { const t = argv.replace(/^directive\s*/, '').trim(); return { text: t ? await addDirective($, t) : 'orc directive: usage: /orc directive <text>' } }
    if (/^continue\b/.test(argv)) return { text: await continueMission($, argv.replace(/^continue\s*/, '').trim()) }
    if (/^backlog\b/.test(argv)) {
      const rest = argv.replace(/^backlog\s*/, '').trim()
      if (/^add\s+/.test(rest)) return { text: await backlogOp($, 'add', rest.replace(/^add\s+/, '')) }
      if (/^next\b/.test(rest)) return { text: await backlogOp($, 'next') }
      return { text: await backlogOp($, 'list') }
    }
    if (/^understanding\b/.test(argv)) {
      const m = await read($, missionState)
      return { text: m ? renderUnderstanding(m) : 'orc: no mission. Start one with /orc begin <request>.' }
    }
    const arg = e.args.trim().split(/\s+/)[0] ?? ''
    if (arg === 'clear') {
      await update($, turns, () => [])
      await update($, cur, () => null)
      await update($, agents, () => ({}))
      await update($, journal, () => [])
      return { text: 'orc: cleared.' }
    }
    if (arg === 'export') {
      const path = await writeLedger($)
      const n = ((await read($, turns)) ?? []).length
      return { text: `orc: ${n} turn rows at ${path}` }
    }
    if (arg === 'turns') {
      const list = (await read($, turns)) ?? []
      if (list.length === 0) return { text: 'orc: no completed turns yet.' }
      const head = ' turn   wall  model  tools calls    ctx     in  nav mech ver docs del hum ext oth  prompt'
      const lines = list.slice(-40).map(t => {
        const tm = toolMs(t)
        const cells = CLASSES.map(c => pct(t.classes[c]?.ms ?? 0, tm).padStart(4)).join(' ')
        return `${String(t.n).padStart(5)} ${clock((t.endedAt ?? t.startedAt) - t.startedAt).padStart(6)} ${clock(t.modelMs).padStart(6)} ${clock(tm).padStart(6)} ${String(toolCount(t)).padStart(5)} ${k(t.contextTokens).padStart(6)} ${kb(inBytes(t)).padStart(6)} ${cells}  ${short(t.prompt, 40)}`
      })
      return { text: [head, ...lines].join('\n') }
    }
    if (arg === 'study') {
      if (!LAB) return { text: 'orc study is a lab feature: set "lab": true in ~/.claude/orc/config.json to use it.' }
      const list = (await read($, turns)) ?? []
      const open = await read($, cur)
      const all = open ? [...list, open] : list
      if (all.length === 0) return { text: 'orc: nothing measured yet.' }
      const acts = sumActivities(all)
      const totalMs = ACTIVITIES.reduce((n, a) => n + acts[a].ms, 0)
      const totalIn = ACTIVITIES.reduce((n, a) => n + acts[a].inBytes, 0)
      const totalCalls = ACTIVITIES.reduce((n, a) => n + acts[a].count, 0)
      const modelMs = all.reduce((n, t) => n + t.modelMs, 0)
      const head = 'code  activity    calls  share   time  share    read  share  (study: intake = 18–26% of calls, 47–60% of bytes)'
      const lines = ACTIVITIES.filter(a => acts[a].count > 0).map(a =>
        `${a}     ${ACTIVITY_NAME[a].padEnd(10)} ${String(acts[a].count).padStart(5)} ${pct(acts[a].count, totalCalls).padStart(5)} ${clock(acts[a].ms).padStart(6)} ${pct(acts[a].ms, totalMs).padStart(5)} ${kb(acts[a].inBytes).padStart(7)} ${pct(acts[a].inBytes, totalIn).padStart(5)}`)
      const labRows = Object.values((await read($, agents)) ?? {}).filter(a => a.type.startsWith('orc:'))
      const labLines = labRows.flatMap(a => {
        const tm = CLASSES.reduce((n, c) => n + (a.classes?.[c]?.ms ?? 0), 0)
        const calls = CLASSES.reduce((n, c) => n + (a.classes?.[c]?.count ?? 0), 0)
        const bytes = CLASSES.reduce((n, c) => n + (a.classes?.[c]?.inBytes ?? 0), 0)
        const oa2 = a.outArgChars ?? 0, op2 = a.outProseChars ?? 0, ot2 = a.outThinkChars ?? 0
        return [
          `${glyph(a.status)} ${a.type} ${a.id.slice(0, 7)} "${short(a.description, 40)}" · ${a.status} · model ${clock(a.modelMs)}/${a.steps} req (${pct(a.modelMs, a.modelMs + tm)} judgment) · tools ${clock(tm)}/${calls} · read ${kb(bytes)} · ctx last ${k(a.ctxTokens ?? 0)} max ${k(a.ctxMax ?? 0)} · children ${a.children ?? 0}`,
          `    ${ACTIVITIES.filter(x => (a.activities?.[x]?.count ?? 0) > 0).map(x => `${ACTIVITY_NAME[x]} ${pct(a.activities?.[x]?.ms ?? 0, tm)}/${pct(a.activities?.[x]?.inBytes ?? 0, bytes)}`).join(' · ') || 'no tool calls'}`,
          `    output: tool args ${kb(oa2)} · prose ${kb(op2)} · thinking ${kb(ot2)}`,
        ]
      })
      const oa = all.reduce((n, t) => n + (t.outArgChars ?? 0), 0)
      const op = all.reduce((n, t) => n + (t.outProseChars ?? 0), 0)
      const ot = all.reduce((n, t) => n + (t.outThinkChars ?? 0), 0)
      return {
        text: [
          head,
          ...lines,
          `model requests ${clock(modelMs)} = ${pct(modelMs, modelMs + totalMs)} of active time · ${all.length} turns`,
          `model output by destination: tool args ${kb(oa)} (${pct(oa, oa + op + ot)}) · prose ${kb(op)} (${pct(op, oa + op + ot)}) · thinking ${kb(ot)} (${pct(ot, oa + op + ot)})`,
          ...(labLines.length ? ['', 'lab agents (orc:*):', ...labLines] : []),
        ].join('\n'),
      }
    }
    if (arg === 'journal') {
      const list = (await read($, journal)) ?? []
      if (list.length === 0) return { text: 'orc: journal is empty.' }
      const t0 = list[0]?.t ?? 0
      return { text: list.slice(-60).map(x => `+${clock(x.t - t0).padStart(6)} ${x.kind.padEnd(7)} ${x.agentId ? x.agentId.slice(0, 7) : '  main '} ${x.text}`).join('\n') }
    }
    if (arg === 'agents') {
      const rows = Object.values((await read($, agents)) ?? {})
      if (rows.length === 0) return { text: 'orc: no subagents yet this session.' }
      const now = await $.clock.now()
      return {
        text: rows
          .map(a => `${glyph(a.status)} ${a.id.slice(0, 7)} ${a.type.padEnd(16)} ${a.status.padEnd(9)} ${String(a.toolCalls).padStart(3)} tools ${clock((a.endedAt ?? now) - a.startedAt).padStart(6)} model ${clock(a.modelMs).padStart(5)} in ${k(a.inputTokens + a.cacheReadTokens).padStart(5)} out ${k(a.outputTokens).padStart(5)}  ${a.description}`)
          .join('\n'),
      }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'orc: pane open.' : `orc: pane not placed (${opened.reason}).` }
  })

  // ---- drawing ------------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const mis = await read($, missionState)
    const done = (await read($, turns)) ?? []
    const open = await read($, cur)
    const map = (await read($, agents)) ?? {}
    const list = (await read($, journal)) ?? []
    await read($, tick)
    const now = await $.clock.now()
    const width = Math.max(44, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const height = Math.max(10, e.viewport?.rows ?? 30)

    const focus = open ?? done[done.length - 1] ?? null
    const focusLabel = open ? `turn ${open.n} (live)` : focus ? `turn ${focus.n}` : 'no turn yet'
    const all = open ? [...done, open] : done
    const session = sumClasses(all)
    const sessionToolMs = CLASSES.reduce((n, c) => n + session[c].ms, 0)
    const sessionModelMs = all.reduce((n, t) => n + t.modelMs, 0)
    const sessionCalls = CLASSES.reduce((n, c) => n + session[c].count, 0)
    const sessionIn = CLASSES.reduce((n, c) => n + session[c].inBytes, 0)
    const sessionWall = all.length ? now - (all[0]?.startedAt ?? now) : 0
    const rows = Object.values(map).sort((a, b) => a.startedAt - b.startedAt)
    const running = rows.filter(a => a.status === 'running' || a.status === 'pending')
    const barWidth = Math.max(6, Math.min(16, width - 46))

    const fTool = focus ? toolMs(focus) : 0
    const fMax = focus ? Math.max(1, ...CLASSES.map(c => focus.classes[c]?.ms ?? 0)) : 1
    const fWall = focus ? (focus.endedAt ?? now) - focus.startedAt : 0

    const agentRoom = Math.max(0, Math.min(rows.length, 6))
    const journalRoom = Math.max(2, Math.min(8, height - 16 - agentRoom * 2))
    const used = CLASSES.filter(c => session[c].count > 0)
    const acts = sumActivities(all)
    const usedActs = ACTIVITIES.filter(a => acts[a].count > 0).sort((x, y) => acts[y].ms - acts[x].ms)

    const gatePending = !!mis?.understanding && (mis.status === 'understanding_requested' || mis.status === 'permission_requested')
    const sbStatus = mis?.understanding?.plan?.nodes?.length ? await sandboxStatusCached($, mis.repo) : undefined
    const gateIs1 = mis?.status === 'understanding_requested'
    const gateName = gateIs1 ? 'understanding' : 'permission'
    return (
      <Box flexDirection="column">
        {gatePending && mis?.understanding ? (
          <Box key="gate" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
            <Text bold color="black" backgroundColor="yellow">{` ACTION NEEDED · ${gateIs1 ? 'GATE 1 of 2' : 'GATE 2 of 2'} `}</Text>
            <Text bold>{gateIs1 ? 'Is this what you mean?' : 'Approve this plan and these rules? Approving starts the work.'}</Text>
            <Text wrap="truncate">{short(mis.understanding.mission.statement || '(no statement yet)', width - 6)}</Text>
            {gateIs1 ? (
              <Text dimColor wrap="truncate">{`you said: ${short(mis.understanding.sourceEvidence.originalRequest, width - 16)}`}</Text>
            ) : (
              <Text dimColor wrap="truncate">{`plan: ${(mis.understanding.plan?.nodes ?? []).length} steps · ${mis.understanding.executionPolicy?.maxAgents ?? '?'} agents at most · ${mis.understanding.executionPolicy?.maxDurationMinutes ?? '?'} min · mode ${mis.understanding.executionPolicy?.mode ?? 'normal'}`}</Text>
            )}
            {!gateIs1 && (mis.understanding.executionPolicy?.capabilities ?? []).length ? (
              <Text color="yellow" wrap="truncate">{`will use: ${[...new Set((mis.understanding.executionPolicy?.capabilities ?? []).map(c => c.need))].join('; ')}`}</Text>
            ) : null}
            {!gateIs1 && sbStatus ? <Text wrap="truncate">{computerLine(mis, sbStatus)}</Text> : null}
            <Text dimColor wrap="truncate">{`${mis.understanding.finalPicture.criteria.length} criteria · full text: ${mis.dir}/UNDERSTANDING.md`}</Text>
            <Box marginTop={1}>
              <Button key="gate-approve" label="Approve" variant="primary" autoFocus onPress={() => { void recordDecision($, gateName, 'approve') }} />
              <Text> </Text>
              <Button key="gate-correct" label="Correct" variant="secondary" onPress={() => { void recordDecision($, gateName, 'correct', 'corrections follow in chat') }} />
              <Text> </Text>
              <Button key="gate-defer" label="Defer" variant="secondary" onPress={() => { void recordDecision($, gateName, 'defer') }} />
            </Box>
            <Text dimColor>or type /orc approve · /orc correct {'<what to change>'} · /orc defer</Text>
          </Box>
        ) : null}
        <Text bold>
          Orchestrator effort · {focusLabel} · session {clock(sessionWall)}, {all.length} turns
        </Text>
        {focus ? (
          <Box flexDirection="column">
            <Text dimColor wrap="truncate">
              “{short(focus.prompt, width - 4)}”
            </Text>
            <Text wrap="truncate">
              wall {clock(fWall)} · model {clock(focus.modelMs)} ({focus.steps} req) · tools {clock(fTool)} ({toolCount(focus)}) · ctx {k(focus.contextTokens)} · out {k(focus.outputTokens)} · read {kb(inBytes(focus))}
            </Text>
            <Text dimColor wrap="truncate">
              {'  '}output went to: tool args {kb(focus.outArgChars ?? 0)} · prose {kb(focus.outProseChars ?? 0)} · thinking {kb(focus.outThinkChars ?? 0)}
            </Text>
            {CLASSES.filter(c => focus.classes[c] !== undefined).map(c => {
              const b = focus.classes[c] ?? emptyBucket()
              return (
                <Text key={`f-${c}`} wrap="truncate">
                  {'  '}
                  {c.padEnd(9)} {bar(b.ms, fMax, barWidth)} {String(b.count).padStart(3)} {clock(b.ms).padStart(6)} {kb(b.inBytes).padStart(7)} in{b.failed ? ` ${b.failed} failed` : ''}
                </Text>
              )
            })}
            {focus.spawned.length > 0 && (
              <Text dimColor>
                {'  '}spawned {focus.spawned.length} · finished {focus.finished.length}
              </Text>
            )}
          </Box>
        ) : (
          <Text dimColor>Waiting for the first turn.</Text>
        )}
        <Text> </Text>
        <Text bold>
          session · model {clock(sessionModelMs)} · tools {clock(sessionToolMs)} · {sessionCalls} calls · {kb(sessionIn)} read
        </Text>
        <Text wrap="truncate">
          {'  '}
          {used.length ? used.map(c => `${c} ${pct(session[c].ms, sessionToolMs)}`).join(' · ') : 'no tool calls yet'}
        </Text>
        <Text dimColor wrap="truncate">
          {'  '}think {pct(sessionModelMs, sessionModelMs + sessionToolMs)} of active time
          {used.length ? ` · ${used.map(c => `${c} ${kb(session[c].inBytes)}`).join(' · ')}` : ''}
        </Text>
        <Text wrap="truncate">
          {'  '}study codes: {usedActs.length ? usedActs.map(a => `${ACTIVITY_NAME[a]} ${pct(acts[a].ms, sessionToolMs)}/${pct(acts[a].inBytes, sessionIn)}`).join(' · ') : '—'}
        </Text>
        <Text> </Text>
        <Text bold>
          agents · {running.length} running · {rows.length - running.length} done
        </Text>
        {rows.length === 0 && <Text dimColor>{'  '}none spawned yet</Text>}
        {rows.slice(-agentRoom).map(a => {
          const isLive = a.status === 'running' || a.status === 'pending'
          const color = isLive ? 'yellow' : a.status === 'completed' ? 'green' : 'red'
          return (
            <Box key={a.id} flexDirection="column">
              <Box>
                <Text color={color}>
                  {'  '}
                  {glyph(a.status)}{' '}
                </Text>
                <Text bold={isLive} wrap="truncate">
                  {short(a.type, 12).padEnd(12)} {short(a.description, width - 20)}
                </Text>
              </Box>
              <Text dimColor wrap="truncate">
                {'    '}
                {clock((a.endedAt ?? now) - a.startedAt)} · model {clock(a.modelMs)}/{a.steps} req · {a.toolCalls} tools
                {a.toolErrors ? ` (${a.toolErrors} failed)` : ''}
                {a.lastTool && isLive ? ` · ${a.lastTool}` : ''}
                {a.outputTokens ? ` · ${k(a.inputTokens + a.cacheReadTokens)} in / ${k(a.outputTokens)} out` : ''}
                {a.model ? ` · ${a.model}` : ''}
                {a.type.startsWith('orc:') ? ` · ctx ${k(a.ctxTokens ?? 0)} · ${pct(a.modelMs, a.modelMs + CLASSES.reduce((n, c) => n + (a.classes?.[c]?.ms ?? 0), 0))} judgment` : ''}
              </Text>
            </Box>
          )
        })}
        {mis ? (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>
              Mission v{mis.version} · {mis.status} · {short(mis.repo, width - 30)}
            </Text>
            {mis.understanding ? (
              <Text wrap="truncate">
                {'  '}{short(mis.understanding.mission.statement || '(no statement yet)', width - 4)}
              </Text>
            ) : null}
            {mis.understanding ? (
              <Text dimColor wrap="truncate">
                {'  '}{mis.understanding.finalPicture.criteria.length} criteria · {(mis.understanding.plan?.nodes ?? []).length} nodes · {mis.understanding.finalPicture.exclusions.length} exclusions · {mis.findings.length} findings · {(mis.understanding.openQuestions ?? []).length} open questions
              </Text>
            ) : null}
            {mis.status === 'understanding_requested' && mis.understanding ? (
              <Box flexDirection="column">
                <Text dimColor wrap="truncate">{'  '}you said: {short(mis.understanding.sourceEvidence.originalRequest, width - 12)}</Text>
                <Text dimColor wrap="truncate">{'  '}evidence: {mis.understanding.sourceEvidence.items.filter(i => i.classification === 'supplied').length} supplied · {mis.understanding.sourceEvidence.items.filter(i => i.classification === 'proposed_interpretation').length} proposed by the model · {mis.understanding.sourceEvidence.items.filter(i => i.classification === 'reported_information').length} reported</Text>
              </Box>
            ) : null}
            {mis.status === 'permission_requested' && mis.understanding ? (
              <Box flexDirection="column">
                <Text dimColor wrap="truncate">
                  {'  '}plan: {(mis.understanding.plan?.nodes ?? []).map(n => n.id).join(' ')} · rules: {mis.understanding.executionPolicy?.maxAgents ?? '?'} agents · {mis.understanding.executionPolicy?.maxAttemptsPerNode ?? '?'} attempts/node · {mis.understanding.executionPolicy?.maxDurationMinutes ?? '?'} min · {(mis.understanding.executionPolicy?.allowedEffects ?? []).join(',')} · paths {mis.understanding.executionTarget?.allowedPaths.join(' ') || 'whole repo'}
                </Text>
                <Text dimColor wrap="truncate">{'  '}{(mis.understanding.options ?? []).length} rules carry alternatives (see UNDERSTANDING.md "Rules recommended")</Text>
              </Box>
            ) : null}
            {mis.status === 'understanding_requested' || mis.status === 'permission_requested' ? (
              <Text color="yellow" wrap="truncate">{'  '}waiting for your decision: see the card at the top</Text>
            ) : null}
            {sbStatus && !gatePending ? <Text dimColor wrap="truncate">{'  '}{computerLine(mis, sbStatus)}</Text> : null}
            <Text dimColor wrap="truncate">
              {'  '}{mis.dir}/UNDERSTANDING.md{' · /orc understanding · approve | correct <note> | defer · resume · directive · backlog'}
            </Text>
          </Box>
        ) : null}
        <Text> </Text>
        <Text dimColor>journal · /orc journal, /orc turns, /orc export</Text>
        {list.slice(-journalRoom).map(x => (
          <Text dimColor wrap="truncate">
            {'  '}
            {x.agentId ? x.agentId.slice(0, 7) : 'main   '} {short(x.text, width - 11)}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const done = (await read($, turns)) ?? []
    const open = await read($, cur)
    const hidden = await read($, isBandHidden)
    const focus = open ?? done[done.length - 1] ?? null
    if (e.props.hasSurvey || !focus || hidden) return next(e)
    await read($, tick)
    const map = (await read($, agents)) ?? {}
    const running = Object.values(map).filter(a => a.status === 'running' || a.status === 'pending').length
    const tm = toolMs(focus)
    const top = CLASSES.filter(c => (focus.classes[c]?.ms ?? 0) > 0)
      .sort((a, b) => (focus.classes[b]?.ms ?? 0) - (focus.classes[a]?.ms ?? 0))
      .slice(0, 3)
    const { Box, Button, Text } = $.ui.resolve(e)
    const mis = await read($, missionState)
    const pending = mis && (mis.status === 'understanding_requested' || mis.status === 'permission_requested')
    const inboxOpen = ((await read($, inboxState)) ?? []).filter(i => !i.ackedAt).length
    return (
      <Box>
        {pending ? (
          <Text bold color="black" backgroundColor="yellow">{` orc: your approval is needed · ${mis!.status === 'understanding_requested' ? 'gate 1 of 2' : 'gate 2 of 2'} `}</Text>
        ) : null}
        {pending ? <Text> </Text> : null}
        <Text dimColor wrap="truncate">
          {inboxOpen ? `orc: inbox ${inboxOpen} awaiting action → ` : ''}orc t{focus.n}
          {open ? '·live' : ''} · model {clock(focus.modelMs)} · tools {clock(tm)}/{toolCount(focus)}
          {top.length ? ` (${top.map(c => `${c.slice(0, 3)} ${pct(focus.classes[c]?.ms ?? 0, tm)}`).join(' ')})` : ''} · ctx {k(focus.contextTokens)}
          {running ? ` · ${running} agents` : ''}{' '}
        </Text>
        <Button key="open" label="Pane" onPress={() => openPane($)} />
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })
}
