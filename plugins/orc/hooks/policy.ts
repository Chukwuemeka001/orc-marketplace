import type { OrcAgent, OrcTurn } from '../types'

/** Which permission requests orc answers itself. Pure, so the tests can check every case.
 *
 *  While a mission the owner approved is running, read-only tools may look inside orc's own data folder (the relay
 *  prompts it asks the main session to read, saved reports) and the clones and verifier snapshots it cut beside the
 *  repository (`<repo>-wt/`). Anything else, and every write, stays with Claude Code and the person. */
export function ownReadRoot(tool: string, input: { file_path?: unknown; path?: unknown } | undefined, mission: { status?: string; repo?: string } | null | undefined, outDir: string, home: string): string | undefined {
  if (!['Read', 'Grep', 'Glob'].includes(tool)) return undefined
  const target = String(input?.file_path ?? input?.path ?? '').replace(/^~(?=\/|$)/, home)
  if (!target.startsWith('/') || target.split('/').includes('..')) return undefined
  if (mission?.status !== 'running' || !mission.repo) return undefined
  const roots = [outDir, `${mission.repo.replace(/\/+$/, '')}-wt`].filter(r => r.startsWith('/') && r.length > 1)
  return roots.find(r => target === r || target.startsWith(`${r}/`))
}

/** A shell command as code: heredoc bodies dropped (their `<<` line kept) and quoted text masked at the same length,
 *  so positions in `masked` still index `code`. A work order that merely quotes "git add -A" is text, not a command
 *  (Desktop run 2026-10-08: such a heredoc-free quoted string was denied), and a command after a heredoc is still seen. */
export function shellMask(cmd: string): { code: string; masked: string } {
  const code = cmd.replace(/<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, m => m.slice(0, m.indexOf('\n')))
  const masked = code.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, m => m[0] + '_'.repeat(Math.max(0, m.length - 2)) + m[m.length - 1])
  return { code, masked }
}

/** Sweeping stages ("git add -A", "git add .", "--all", "git commit -a") in a command's code, not its quoted text. */
export function sweepsStage(cmd: string): boolean {
  const { masked } = shellMask(cmd)
  return /\bgit\s+(add|stage)\b[^;&|\n]*(\s-A\b|\s--all\b|\s\.(\s|$))/m.test(masked) || /\bgit\s+commit\b[^;&|\n]*\s(-a|--all|-am)\b/m.test(masked)
}

/** The part of a mission the computer rules read. */
export type PlanLike = { repo: string; understanding?: { executionPolicy?: { capabilities?: { need: string; why?: string; by: string; permission?: string }[] } } | null }

/** Did the approved plan grant a browser to this role (builder | verifier)? */
export const browserGranted = (m: PlanLike | null | undefined, role: string) => (m?.understanding?.executionPolicy?.capabilities ?? []).some(c => /browser|chrom|viewport|playwright/i.test(c.need) && new RegExp(role, 'i').test(c.by))

/** The orc computer for a mission: the workspace (repo + clones), the hosts the plan named, who holds the browser. */
export function computerOf(m: PlanLike) {
  const caps = m.understanding?.executionPolicy?.capabilities ?? []
  const hosts = [...new Set(caps.flatMap(c => (`${c.need} ${c.permission ?? ''}`.match(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|app|co|ca|uk)\b/gi) ?? []).map(h => h.toLowerCase())))]
  const browser = ['builder', 'verifier'].filter(r => browserGranted(m, r))
  return { workspace: [m.repo, `${m.repo.replace(/\/+$/, '')}-wt`], hosts, browser }
}
/** The sandbox settings that make this mission's computer (Claude Code's built-in sandbox; fixed at session start). */
export function sandboxSettingsFor(m: PlanLike) {
  const c = computerOf(m)
  return { enabled: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: [c.workspace[1]] }, network: { allowLocalBinding: true, allowedDomains: c.hosts } }
}

/** The browser tools a worker may hold. Withheld, because they act outside the sandbox from the browser server's own
 *  process: browser_run_code_unsafe ("executes arbitrary JavaScript in the Playwright server process"),
 *  browser_file_upload and browser_drop (read local files). browser_evaluate runs in the page, so it stays.
 *  (orc computer v1 live test, 2026-10-08: a builder used browser_run_code_unsafe for its layout check.) */
export const BROWSER_SERVER = 'orc-browser'
export const SAFE_BROWSER_TOOLS = ['browser_navigate', 'browser_navigate_back', 'browser_resize', 'browser_snapshot', 'browser_take_screenshot', 'browser_evaluate', 'browser_click', 'browser_type', 'browser_press_key', 'browser_hover', 'browser_select_option', 'browser_fill_form', 'browser_drag', 'browser_wait_for', 'browser_console_messages', 'browser_network_requests', 'browser_network_request', 'browser_find', 'browser_emulate_media', 'browser_handle_dialog', 'browser_tabs', 'browser_close'].map(t => `mcp__${BROWSER_SERVER}__${t}`)
export const UNSAFE_BROWSER_TOOLS = ['browser_run_code_unsafe', 'browser_file_upload', 'browser_drop'].map(t => `mcp__${BROWSER_SERVER}__${t}`)
/** May orc approve this browser call without a dialog? Only a listed safe tool. */
export const browserCallAllowed = (tool: string) => SAFE_BROWSER_TOOLS.includes(tool)

/** The part of a mission the continue rule reads. */
export type ContinueLike = { status?: string; mode?: string; version?: number; understanding?: unknown; missionFile?: string; dir?: string } | null | undefined
/** Why /orc continue is refused, or undefined when it may go ahead: only a finished, main-mode mission with an approved
 *  understanding continues, and only with a request. */
export function continueRefusal(m: ContinueLike, request: string): string | undefined {
  if (!m) return 'orc continue: no mission in this session. Resume one first with /orc resume [repo], or start one with /orc begin <request>.'
  if (!request.trim()) return 'orc continue: say what comes next, in your words: /orc continue <request>.'
  if (m.status === 'running') return `orc continue: mission v${m.version} is still running; tell the orchestrator directly, or record a standing rule with /orc directive <text>.`
  if (m.status !== 'done') return `orc continue: mission v${m.version} is in intake (${m.status}); answer the gates first.`
  if (!m.understanding && !m.missionFile) return 'orc continue: this mission has neither an approved understanding nor a mission file; start with /orc begin <request>.'
  if (m.mode === 'subagent') return `orc continue: this mission was orchestrated by a subagent; continue it with /orc start ${m.missionFile ?? `${m.dir}/MISSION.md`} fresh=1 amendment=<request>.`
  return undefined
}

/** The system-prompt section while a finished mission is loaded in the session: the owner may ask for more, and the
 *  answer is /orc continue, never orchestrating by hand (Emeka's NCLEX run, 2026-10-08: Phases 2–7 ran outside orc). */
export function doneSection(m: { repo: string; version: number; outcome?: { lines: string[] } | null }): string {
  return [
    `# orc: the mission in ${m.repo} is finished (v${m.version})`,
    ...(m.outcome?.lines?.length ? m.outcome.lines : []),
    'The orc plugin adds this section while a finished mission is loaded in this session. If the owner asks for more work on this repository, do not orchestrate by hand (no Agent calls for builders or verifiers, no commits that sweep staged files):',
    '- more of the same mission (the next phase, "continue until done", a follow-up): call mcp__orc__continue {request: <their words>} FIRST. It carries the approved understanding, plan, rules and standing directives into a new version under orc (clones, checks, verifiers, merges and the pane come back; no new interview or gate) and hands you the working rules as the next prompt.',
    '- a different goal: /orc backlog add <request> then /orc backlog next (a new intake with gates), or /orc begin <request>.',
    '- questions, reports and reading need nothing: just answer.',
  ].join('\n')
}

// ---- 0.22.0: the numbers beside the reading (lab: ops/DESIGN-RAW-SIGNAL.md) ---------------------------------------------
// The substrate writes the numbers (ops/orc/LEDGER.md + ledger.json); the orchestrator writes the reading. Everything
// below is pure so a fixture can prove the projection, the parsers and the owner's four lines.

const shortT = (s: string | undefined, n: number) => (s === undefined ? '' : s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…')
/** Tokens the way the ledger prints them: 1.93M, 412k, 980. */
export const tok = (n: number) => (n >= 500000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.max(0, Math.round(n))))
const clockT = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` }
const isoT = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const hms = (ms: number) => new Date(ms).toISOString().slice(11, 19)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const cell = (s: string) => s.replace(/\|/g, '∣').replace(/\s+/g, ' ').trim()
const pctT = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : '0%')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const childrenWord = (n: number) => `${n} ${n === 1 ? 'child' : 'children'}`

/** A passing check's tail reduced to its measured facts (test counts, timings, OK/PASS lines): at most 4 lines on one line. */
export function evidenceDigest(tail: string) {
  const facts = tail.split('\n').map(l => l.trim()).filter(l => l && /\b(Ran \d+|\d+ (passed|failed|tests?)|elapsed|INTEGRATION|OK\b|PASS\b|\d+(\.\d+)?\s?(s|ms|sec)\b)/.test(l))
  return facts.slice(-4).map(l => shortT(l, 90)).join(' · ')
}

/** A verifier's report, counted by the substrate: VERDICT, one line per criterion ("PASS|FAIL|N/A <n> …", bullets
 *  allowed) under CRITERIA:, and the DEFECTS: items. The orchestrator never counts these itself. */
export type VerifierCounts = { verdict: 'PASS' | 'FAIL' | 'none'; pass: number; fail: number; na: number; defects: number }
export function verifierCounts(answer: string): VerifierCounts {
  const lines = answer.replace(/\*\*/g, '').split('\n')
  const header = /^\s*(?:[-*•]\s*)?(VERDICT|CRITERIA|DEFECTS|NOT CHECKED)\s*:\s*(.*)$/i
  const sections: Record<string, string[]> = {}
  let cur = 'HEAD'
  for (const l of lines) {
    const h = header.exec(l)
    if (h) { cur = h[1]!.toUpperCase(); sections[cur] = [...(sections[cur] ?? []), h[2] ?? '']; continue }
    sections[cur] = [...(sections[cur] ?? []), l]
  }
  const v = /^\s*(PASS|FAIL)\b/i.exec((sections.VERDICT ?? [])[0] ?? '')?.[1]?.toUpperCase()
  const verdict: VerifierCounts['verdict'] = v === 'PASS' || v === 'FAIL' ? v : 'none'
  const crit = /^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?(PASS|FAIL|N\/A)\b/i
  const pool = sections.CRITERIA ?? [...(sections.HEAD ?? [])]
  let pass = 0, fail = 0, na = 0
  for (const l of pool) {
    const m = crit.exec(l)
    if (!m) continue
    const w = m[1]!.toUpperCase()
    if (w === 'PASS') pass += 1; else if (w === 'FAIL') fail += 1; else na += 1
  }
  const items = (sections.DEFECTS ?? []).map(l => l.trim()).filter(l => l && !/^(none|no defects|n\/a|—|-|\(none\))\.?$/i.test(l))
  const bullets = items.filter(l => /^(?:[-*•]|\d+[.)])\s/.test(l))
  return { verdict, pass, fail, na, defects: bullets.length ? bullets.length : items.length }
}

/** What ops/FINAL.md must carry before a final verification is requested: the status, the orchestrator's one-sentence
 *  READING, the NUMBERS pointer and a "## Numbers" section with a CLAIMED and a READ line. The PROVED line is the
 *  substrate's (stampReport writes it at the request), so a draft need not carry it. Returns the missing lines (empty =
 *  the shape is complete), like the DECISIONS header check names its lines. */
export const NUMBERS_LINE_HINT = 'NUMBERS: line (ops/orc/LEDGER.md; the substrate stamps the time)'
export function finalReportShape(text: string): string[] {
  const t = text.replace(/\*\*/g, '')
  const missing: string[] = []
  if (!/^STATUS:\s*\S/m.test(t)) missing.push('STATUS: line')
  if (!/^READING:\s*\S/m.test(t)) missing.push('READING: line (one sentence: your reading of the outcome)')
  if (!/^NUMBERS:\s*\S/m.test(t)) missing.push(NUMBERS_LINE_HINT)
  const lines = t.split('\n')
  const i = lines.findIndex(l => /^##\s*Numbers\b/i.test(l))
  if (i < 0) missing.push('"## Numbers" section')
  else {
    const body: string[] = []
    for (let j = i + 1; j < lines.length && !/^#/.test(lines[j]!); j++) body.push(lines[j]!)
    const has = (re: RegExp) => body.some(l => re.test(l))
    if (!has(/^\s*(?:[-*]\s*)?CLAIMED\b/)) missing.push('CLAIMED line in "## Numbers" (a child\'s figures, naming the report file)')
    if (!has(/^\s*(?:[-*]\s*)?READ(?!ING)\b/)) missing.push('READ line in "## Numbers" (your sentence)')
  }
  return missing
}

/** A checkpoint report is only warned about (0.22.0 choice): it should carry the NUMBERS: line. */
export function checkpointReportShape(text: string): string[] {
  return /^NUMBERS:\s*\S/m.test(text.replace(/\*\*/g, '')) ? [] : [NUMBERS_LINE_HINT]
}

/** The substrate stamps a report with the ledger it commits beside it (WO-0220b): the `NUMBERS:` line becomes the
 *  pointer with the ledger's time, the `PROVED (ledger):` line of "## Numbers" becomes the ledger's headline (its three
 *  lines joined by " · "); a "## Numbers" section without a PROVED line gets one as its first line; without the section,
 *  a bare `PROVED (ledger):` line anywhere is stamped. No other line changes, so the orchestrator never writes a PROVED
 *  figure and can never get one wrong. */
export function stampReport(text: string, headline: string[], at: number): { text: string; stamped: ('NUMBERS' | 'PROVED')[] } {
  const lines = text.split('\n')
  const stamped: ('NUMBERS' | 'PROVED')[] = []
  const plain = (l: string) => l.replace(/\*\*/g, '').replace(/^\s*(?:[-*•]\s*)?/, '')
  const numbersLine = `NUMBERS: ops/orc/LEDGER.md @ ${isoT(at)} (stamped by the substrate)`
  const provedLine = `PROVED (ledger): ${headline.join(' · ')}`
  const iN = lines.findIndex(l => /^NUMBERS:/.test(plain(l)))
  if (iN >= 0) { lines[iN] = numbersLine; stamped.push('NUMBERS') }
  const iS = lines.findIndex(l => /^##\s*Numbers\b/i.test(l))
  if (iS >= 0) {
    let end = iS + 1
    while (end < lines.length && !/^#/.test(lines[end]!)) end += 1
    const iP = lines.findIndex((l, i) => i > iS && i < end && /^PROVED\b/.test(plain(l)))
    if (iP >= 0) lines[iP] = provedLine; else lines.splice(iS + 1, 0, provedLine)
    stamped.push('PROVED')
  } else {
    const iP = lines.findIndex(l => /^PROVED \(ledger\):/.test(plain(l)))
    if (iP >= 0) { lines[iP] = provedLine; stamped.push('PROVED') }
  }
  return { text: lines.join('\n'), stamped }
}

/** Is this main-session prompt an orc wake, and why did it come? The prompt is the engine's text, which may carry a
 *  "The orc plugin sent a message: orc inbox (automatic) — " prefix before "[orc wake]" / "[orc inbox]" / "[orc graph]". */
export function wakeWhy(text: string): string | undefined {
  const head = text.slice(0, 200)
  if (!/\[orc (wake|inbox|graph)\]/.test(head)) return undefined
  const items = (text.match(/\(ib-[0-9a-z]+, (wake|spawn|notice)\)/g) ?? []).length
  const more = items > 1 ? ` (+${items - 1} more)` : ''
  const ret = /RETURNED:\s*([0-9a-f]{7})[0-9a-f]*\s+"([^"]*)"\s*\(([^)]*)\)/.exec(text)
  if (ret) {
    const type = ret[3]!.replace(/-web$/, '')
    if (type === 'verifier') { const st = /auto verifier:\s*(\w+)/.exec(ret[2]!)?.[1]; return `${st ? `${st} ` : ''}verifier returned${more}` }
    if (type === 'integrator') return `integrator returned${more}`
    return `${shortT(ret[2]!.replace(/\s*\[for [^\]]*\]$/, ''), 36)} returned${more}`
  }
  if (/integration check after merge of/.test(text)) return `integration result${more}`
  if (/\[orc liveness\]/.test(text)) return `liveness notice${more}`
  if (/\[orc graph\]/.test(head)) return `graph: ${shortT(text.slice(text.indexOf('[orc graph]') + 11).trim(), 50)}${more}`
  if (/\[orc preflight\]/.test(text)) return `dispatch preflight${more}`
  if (/\(ib-[0-9a-z]+, spawn\)/.test(text)) return `spawn request${more}`
  if (/\(ib-[0-9a-z]+, notice\)/.test(text)) return `notice${more}`
  if (/CHANGED: nothing new/.test(text)) return `re-delivered wake${more}`
  return `wake${more}`
}

/** WO-0220c: one registered check run and one mark, as the ledger keeps them (every one, oldest first). */
export type LedgerCheck = { at: number; status: string; ms: number; evidence: string }
export type LedgerMark = { verdict: string; note: string; at: number; by?: string }
/** A child's row. `check` and `mark` are the latest (existing readers); `checks` and `marks` are the whole history, and
 *  `attempts` the returns recorded (a child steered after a redo, or resumed, returns more than once). */
export type LedgerChild = { id: string; type: string; description: string; status: string; startedAt: number; endedAt?: number; toolCalls: number; tokens: number; check?: { status: string; ms: number; evidence: string }; checks?: LedgerCheck[]; attempts?: number; boundary?: string; merge?: string; mark?: { verdict: string; note: string; at: number }; marks?: LedgerMark[]; reportPath?: string; counts?: VerifierCounts }
export type LedgerVerification = { id: string; stage: string; at: number; sha?: string; verifierId?: string; returnedAt?: number; counts?: VerifierCounts; reportPath?: string }
export type LedgerRun = { at: number; after: string; status: string; ms: number; load?: number; cores?: number }
export type LedgerWake = { turnId: string; at: number; why: string; ctx: number; inTokens: number; outTokens: number; steps: number; marks: string[] }
/** The intake's cost: the main session's turns from the mission's begin (/orc begin, the record's creation) to the
 *  launch of the orchestrator row, i.e. the interview and the two gates. Frozen at launch; absent when that launch
 *  happened in a session whose turns this one never saw ("not recorded in this session"). */
export type LedgerIntake = { requests: number; tokens: number; ms: number }
export type LedgerVersion = {
  version: number; startedAt: number; endedAt?: number; status: 'running' | 'done'; finalStatus?: string
  cursor: number; compactions: number
  /** the orchestrator's own cost, per session that ran it (a resumed mission adds a session; counters never restart) */
  orchestrator: Record<string, { tokens: number; ctxMax: number }>
  /** the intake before approval: counted in the orchestrator's share and the headline total */
  intake?: LedgerIntake
  children: Record<string, LedgerChild>
  verifications: Record<string, LedgerVerification>
  runs: Record<string, LedgerRun>
  wakes: Record<string, LedgerWake>
  gates?: { id: string; kind: string; reachedAt?: number }[]
}
export type Ledger = { format: 1; repo: string; updatedAt: number; versions: LedgerVersion[] }

export const tokensOf = (a: Pick<OrcAgent, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>) => (a.inputTokens ?? 0) + (a.outputTokens ?? 0) + (a.cacheReadTokens ?? 0) + (a.cacheWriteTokens ?? 0)
const roleOf = (type: string) => type.replace(/^orc:/, '').replace(/-web$/, '')
const isVerifier = (c: { type: string }) => roleOf(c.type) === 'verifier'
const returned = (c: { status: string }) => c.status !== 'running' && c.status !== 'pending'

// ---- WO-0220c: attempt history. A child that returns more than once keeps every check result and every mark; the
// counts run over all of them (proof 2: n2 FAIL → redo → steer → PASS → accepted is 2 checks and 1 redo, not 1 and 0).
// A record written before histories existed carries only its latest check, dated at the child's start (the same date
// in every reader, so a merge recognises it), and its latest mark (which has its own date).
type AgentCheck = NonNullable<OrcAgent['checks']>[number]
type AgentMark = NonNullable<OrcAgent['marks']>[number]
/** A child's check runs, oldest first (its `checks`, else its latest `checkResult`). */
export const checkHistory = (a: Pick<OrcAgent, 'startedAt' | 'checks' | 'checkResult'>): AgentCheck[] => (a.checks?.length ? a.checks : a.checkResult ? [{ at: a.startedAt, ...a.checkResult }] : [])
/** A child's marks, oldest first (its `marks`, else its latest `mark`). */
export const markHistory = (a: Pick<OrcAgent, 'marks' | 'mark'>): AgentMark[] => (a.marks?.length ? a.marks : a.mark ? [a.mark] : [])
/** The same two for a ledger row. */
export const checksOf = (c: Pick<LedgerChild, 'startedAt' | 'check' | 'checks'>): LedgerCheck[] => (c.checks?.length ? c.checks : c.check ? [{ at: c.startedAt, ...c.check }] : [])
export const marksOf = (c: Pick<LedgerChild, 'mark' | 'marks'>): LedgerMark[] => (c.marks?.length ? c.marks : c.mark ? [c.mark] : [])
/** Returns recorded for a row: its attempts, at least one per check run, at least one once it has returned. */
export const attemptsOf = (c: LedgerChild) => Math.max(c.attempts ?? 0, checksOf(c).length, returned(c) ? 1 : 0)
/** Two histories as one, keyed by `at` (a union: nothing recorded is ever dropped), oldest first. On the same instant the
 *  newer entry wins unless `keepOld` says the older one is the better record. */
export function unionByAt<T extends { at: number }>(older: T[], newer: T[], keepOld?: (o: T, n: T) => boolean): T[] {
  const m = new Map<number, T>()
  for (const x of older) m.set(x.at, x)
  for (const x of newer) { const o = m.get(x.at); m.set(x.at, o && keepOld?.(o, x) ? o : x) }
  return [...m.values()].sort((p, q) => p.at - q.at)
}
const elide = <T>(list: T[], n: number) => (list.length <= n ? list : [list[0]!, undefined, ...list.slice(-(n - 2))])
/** The check column: `PASS 1s · "evidence"` for one run; `FAIL 1s → PASS 1s (2 runs) · "evidence"` for more. */
export function checkCell(c: Pick<LedgerChild, 'startedAt' | 'check' | 'checks'>): string {
  const h = checksOf(c)
  if (!h.length) return '—'
  const last = h[h.length - 1]!
  const word = (x: LedgerCheck | undefined) => (x ? `${x.status.toUpperCase()} ${clockT(x.ms)}` : '…')
  const seq = h.length === 1 ? word(last) : `${elide(h, 4).map(word).join(' → ')} (${h.length} runs)`
  return `${seq}${last.evidence ? ` · "${shortT(last.evidence, 60)}"` : ''}`
}
/** The mark column: `accepted: "note"` for one mark; `redo → accepted: "note"` for more (the latest carries its note). */
export function markCell(c: Pick<LedgerChild, 'mark' | 'marks'>): string | undefined {
  const h = marksOf(c)
  if (!h.length) return undefined
  const last = h[h.length - 1]!
  return [...elide(h, 4).slice(0, -1).map(m => (m ? m.verdict : '…')), `${last.verdict}: "${shortT(last.note, 70)}"`].join(' → ')
}

/** What the projection reads: the orchestrator's row, its children of this run, the main session's turns, the mission. */
export type LedgerSource = {
  version: number; startedAt: number; now: number; status: 'running' | 'done'; finalStatus?: string; sessionId: string
  orch: Pick<OrcAgent, 'cursor' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'ctxMax' | 'verifyRequests' | 'integration'> | undefined
  kids: OrcAgent[]
  turns: OrcTurn[]
  compactions: number
  gates?: { id: string; kind: string; reachedAt?: number }[]
  intake?: LedgerIntake
}

/** The intake's cost from the main session's closed turns: those begun at or after `beganAt` and finished by the
 *  launch (a turn still open at launch is the orchestrator row's, which accumulates it). */
export function intakeOf(turns: OrcTurn[], beganAt: number, launchAt: number): LedgerIntake {
  const list = turns.filter(t => t.startedAt >= beganAt - 1000 && t.startedAt < launchAt && (t.endedAt ?? launchAt + 1) <= launchAt + 1000)
  return { requests: list.reduce((n, t) => n + (t.steps ?? 0), 0), tokens: list.reduce((n, t) => n + (t.inTokens ?? 0) + (t.outputTokens ?? 0), 0), ms: Math.max(0, launchAt - beganAt) }
}

/** WO-0220c, settle timing: why a running main-mode mission may not settle yet, or undefined when it may. It settles
 *  once ops/FINAL.md has a STATUS: line that is not PENDING, no orc child is live, and no main-session turn is open:
 *  the turn that wrote STATUS settles at its own end, after its tokens are on the orchestrator's row and its wake is in
 *  the ledger (proof 2 settled on the tick mid-turn and lost that turn: 627,797 tokens, 8.55% of the orchestrator's). */
export function settleBlock(o: { status: string | undefined; liveChildren: number; turnOpen: boolean }): string | undefined {
  if (!o.status) return 'ops/FINAL.md has no STATUS: line yet'
  if (/PENDING/i.test(o.status)) return 'ops/FINAL.md is still PENDING'
  if (o.liveChildren > 0) return `${o.liveChildren} child${o.liveChildren === 1 ? ' is' : 'ren are'} still running`
  if (o.turnOpen) return 'a main-session turn is open: the mission settles when it completes'
  return undefined
}
/** A turn's usage as the engine reports it at turn.complete. */
export type TurnUsageLike = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
/** The main session's turn ends: its usage goes on the orchestrator's row (the same accounting as a child's). */
export const withTurnUsage = <A extends Pick<OrcAgent, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>>(a: A, u: TurnUsageLike | undefined): A => ({
  ...a, inputTokens: a.inputTokens + (u?.input_tokens ?? 0), outputTokens: a.outputTokens + (u?.output_tokens ?? 0), cacheReadTokens: a.cacheReadTokens + (u?.cache_read_input_tokens ?? 0), cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
})
/** The open turn, closed: its end, why, the answer's head and its input tokens (input + cache read + cache write). */
export const closedTurn = (open: OrcTurn, u: TurnUsageLike | undefined, now: number, reason: string, answer: string): OrcTurn => ({
  ...open, endedAt: now, reason, answer, inTokens: u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : open.inTokens,
})

/** The request a verifier answers: the latest one made before it started. */
function requestOf(kid: OrcAgent, reqs: NonNullable<OrcAgent['verifyRequests']>) {
  return reqs.filter(v => v.stage !== 'integration' && v.at <= kid.startedAt + 2000).sort((a, b) => b.at - a.at)[0]
}

/** Project the session's records onto one version of the ledger. Nothing new is measured here. */
export function projectLedger(src: LedgerSource): LedgerVersion {
  const kids = src.kids.filter(a => a.type.startsWith('orc:'))
  const reqs = src.orch?.verifyRequests ?? []
  const children: Record<string, LedgerChild> = {}
  for (const a of kids) {
    const st = returned(a) ? (a.status === 'completed' ? 'returned' : a.status) : 'running'
    const b = a.boundaryReport
    const w = a.worktree
    const checks: LedgerCheck[] = checkHistory(a).map(x => ({ at: x.at, status: x.status, ms: x.ms, evidence: x.status === 'pass' ? evidenceDigest(x.outputTail ?? '') : shortT(x.reason ?? (x.outputTail ?? '').split('\n').filter(Boolean).slice(-1)[0] ?? '', 90) }))
    const marks: LedgerMark[] = markHistory(a).map(m => ({ verdict: m.verdict, note: m.note, at: m.at, ...(m.by ? { by: m.by } : {}) }))
    const lastC = checks[checks.length - 1]
    const lastM = marks[marks.length - 1]
    const attempts = Math.max(a.runs ?? 0, checks.length)
    children[a.id] = {
      id: a.id, type: a.type, description: a.description, status: st, startedAt: a.startedAt, endedAt: a.endedAt,
      toolCalls: a.toolCalls ?? 0, tokens: tokensOf(a),
      check: lastC ? { status: lastC.status, ms: lastC.ms, evidence: lastC.evidence } : undefined,
      checks: checks.length ? checks : undefined,
      attempts: attempts || undefined,
      boundary: b ? (b.outside.length ? `${b.outside.length} outside` : 'clean') : a.boundary && st === 'running' ? 'pending' : undefined,
      merge: w ? (w.merged === 'merged' ? `merged${w.mergeSha ? ` ${w.mergeSha.slice(0, 7)}` : ''}` : w.merged ?? (a.mark ? 'not merged' : 'clone')) : undefined,
      mark: lastM ? { verdict: lastM.verdict, note: lastM.note, at: lastM.at } : undefined,
      marks: marks.length ? marks : undefined,
      reportPath: a.reportPath, counts: a.verifierCounts,
    }
  }
  const verifications: Record<string, LedgerVerification> = {}
  for (const v of reqs) {
    if (v.stage === 'integration') continue
    verifications[v.id] = { id: v.id, stage: v.stage, at: v.at, sha: /verify-\w+-([0-9a-f]{7})-/.exec(v.snapshot ?? '')?.[1] }
  }
  for (const kid of kids.filter(isVerifier)) {
    const req = requestOf(kid, reqs)
    if (!req || !verifications[req.id]) continue
    const cur = verifications[req.id]!
    if (cur.verifierId && cur.verifierId !== kid.id && (children[cur.verifierId]?.startedAt ?? 0) >= kid.startedAt) continue
    verifications[req.id] = { ...cur, verifierId: kid.id, returnedAt: kid.endedAt, counts: kid.verifierCounts, reportPath: kid.reportPath }
  }
  const runs: Record<string, LedgerRun> = {}
  for (const r of src.orch?.integration?.runs ?? []) runs[String(r.at)] = { at: r.at, after: r.after, status: r.status, ms: r.ms, load: r.load, cores: r.cores }
  const wakes: Record<string, LedgerWake> = {}
  for (const t of src.turns) {
    if (t.startedAt < src.startedAt - 1000) continue
    const why = t.wake ?? wakeWhy(t.prompt)
    if (!why) continue
    const end = t.endedAt ?? src.now
    const made = kids.flatMap(k => markHistory(k).filter(m => m.at >= t.startedAt && m.at <= end).map(m => ({ at: m.at, text: `${k.id.slice(0, 7)} ${m.verdict}` })))
    wakes[t.turnId] = { turnId: t.turnId, at: t.startedAt, why, ctx: t.contextTokens ?? 0, inTokens: t.inTokens ?? 0, outTokens: t.outputTokens ?? 0, steps: t.steps ?? 0, marks: made.sort((p, q) => p.at - q.at).map(m => m.text) }
  }
  const orchestrator: LedgerVersion['orchestrator'] = src.orch ? { [src.sessionId || 'session']: { tokens: tokensOf(src.orch), ctxMax: src.orch.ctxMax ?? 0 } } : {}
  return { version: src.version, startedAt: src.startedAt, endedAt: src.status === 'done' ? src.now : undefined, status: src.status, finalStatus: src.finalStatus, cursor: src.orch?.cursor ?? 0, compactions: src.compactions, orchestrator, children, verifications, runs, wakes, gates: src.gates, intake: src.intake }
}

const maxN = (a?: number, b?: number) => Math.max(a ?? 0, b ?? 0)
function mergeVersion(o: LedgerVersion, c: LedgerVersion): LedgerVersion {
  const children: Record<string, LedgerChild> = { ...o.children }
  for (const [id, n] of Object.entries(c.children)) {
    const p = children[id]
    if (!p) { children[id] = n; continue }
    // WO-0220c: histories merge by `at` (a union: a resumed session's adopted row, which carries no check and only its
    // latest mark, never shrinks what an earlier session recorded); the latest of each is the row's check and mark.
    const checks = unionByAt(checksOf(p), checksOf(n), (o, x) => !x.evidence && !!o.evidence)
    // The same instant is the same mark: keep the fuller note (an adopted row carries the snapshot's shortened one).
    const marks = unionByAt(marksOf(p), marksOf(n), (o, x) => o.note.length > x.note.length)
    const lastC = checks[checks.length - 1]
    const lastM = marks[marks.length - 1]
    // A row adopted while it ran (zero counters) is not running now; a child resumed for another attempt (it has made
    // tool calls since the last write) is.
    const rerun = n.status === 'running' && n.toolCalls > p.toolCalls
    children[id] = {
      ...p, ...n,
      status: n.status === 'running' && p.status !== 'running' && !rerun ? p.status : n.status,
      endedAt: rerun ? undefined : n.endedAt ?? p.endedAt,
      toolCalls: maxN(p.toolCalls, n.toolCalls), tokens: maxN(p.tokens, n.tokens),
      check: lastC ? { status: lastC.status, ms: lastC.ms, evidence: lastC.evidence } : undefined,
      checks: checks.length ? checks : undefined,
      attempts: Math.max(p.attempts ?? 0, n.attempts ?? 0, checks.length) || undefined,
      boundary: n.boundary ?? p.boundary, merge: n.merge ?? p.merge,
      mark: lastM ? { verdict: lastM.verdict, note: lastM.note, at: lastM.at } : undefined,
      marks: marks.length ? marks : undefined,
      reportPath: n.reportPath ?? p.reportPath, counts: n.counts ?? p.counts,
    }
  }
  const verifications: Record<string, LedgerVerification> = { ...o.verifications }
  for (const [id, n] of Object.entries(c.verifications)) {
    const p = verifications[id]
    verifications[id] = p ? { ...p, ...n, sha: n.sha ?? p.sha, verifierId: n.verifierId ?? p.verifierId, returnedAt: n.returnedAt ?? p.returnedAt, counts: n.counts ?? p.counts, reportPath: n.reportPath ?? p.reportPath } : n
  }
  const orchestrator: LedgerVersion['orchestrator'] = { ...o.orchestrator }
  for (const [sid, n] of Object.entries(c.orchestrator)) { const p = orchestrator[sid]; orchestrator[sid] = p ? { tokens: maxN(p.tokens, n.tokens), ctxMax: maxN(p.ctxMax, n.ctxMax) } : n }
  // The intake was frozen once at launch: a recorded one is never replaced by an absent one, nor shrunk.
  const intake = o.intake && c.intake ? { requests: maxN(o.intake.requests, c.intake.requests), tokens: maxN(o.intake.tokens, c.intake.tokens), ms: maxN(o.intake.ms, c.intake.ms) } : c.intake ?? o.intake
  return {
    ...o, ...c,
    endedAt: o.endedAt ?? c.endedAt, finalStatus: c.finalStatus ?? o.finalStatus,
    cursor: maxN(o.cursor, c.cursor), compactions: maxN(o.compactions, c.compactions),
    orchestrator, children, verifications, runs: { ...o.runs, ...c.runs }, wakes: { ...o.wakes, ...c.wakes }, gates: c.gates ?? o.gates, intake,
  }
}

/** Merge a projection into the durable accumulator: rows by id, wakes by turn, verifications by request; a measured
 *  number is never replaced by a smaller one (a resumed session adopts children with zero counters). A version whose
 *  start differs is a new run of that number and replaces the old section. */
export function mergeLedger(prev: Ledger | undefined, cur: LedgerVersion, repo: string, now: number): Ledger {
  const versions = [...(prev?.versions ?? [])]
  const i = versions.findIndex(v => v.version === cur.version)
  const old = i >= 0 ? versions[i] : undefined
  const merged = old && Math.abs(old.startedAt - cur.startedAt) < 120000 ? mergeVersion(old, cur) : cur
  if (i >= 0) versions[i] = merged; else versions.push(merged)
  versions.sort((a, b) => a.version - b.version)
  return { format: 1, repo, updatedAt: now, versions }
}

export type LedgerStage = { name: string; from: number; to: number; open: boolean; children: LedgerChild[]; verification?: LedgerVerification; tokens: number; checks: { pass: number; total: number }; redo: number }

/** Stages: the windows between verification requests (checkpoint / final); in auto mode the gates fall at the same
 *  requests, so the same windows hold. The open window at the end is the current stage while the mission runs. */
export function ledgerStages(v: LedgerVersion, now: number): LedgerStage[] {
  const kids = Object.values(v.children).sort((a, b) => a.startedAt - b.startedAt)
  const bounds = Object.values(v.verifications).sort((a, b) => a.at - b.at)
  const out: LedgerStage[] = []
  let from = v.startedAt
  let nCheck = 0, nFinal = 0
  const stageOf = (f: number, t: number, ver: LedgerVerification | undefined, name: string, open: boolean): LedgerStage => {
    const inWindow = kids.filter(c => !isVerifier(c) && c.startedAt >= f && (open ? true : c.startedAt < t))
    const verKid = ver?.verifierId ? v.children[ver.verifierId] : undefined
    // Every run and every mark of the stage's children (WO-0220c), the same counts as the headline and the live line.
    const runs = inWindow.flatMap(checksOf)
    const redo = [...inWindow, ...(verKid ? [verKid] : [])].reduce((n, c) => n + marksOf(c).filter(m => m.verdict === 'redo').length, 0)
    return { name, from: f, to: t, open, children: inWindow, verification: ver, tokens: inWindow.reduce((n, c) => n + c.tokens, 0) + (verKid?.tokens ?? 0), checks: { pass: runs.filter(x => x.status === 'pass').length, total: runs.length }, redo }
  }
  for (const b of bounds) {
    const gate = (v.gates ?? []).find(g => g.reachedAt && g.reachedAt >= from && g.reachedAt <= b.at)
    const name = b.stage === 'checkpoint' ? `to checkpoint ${++nCheck}` : `to final${++nFinal > 1 ? ` (${nFinal})` : ''}`
    out.push(stageOf(from, b.at, b, gate ? `${name} · gate ${gate.id}` : name, false))
    from = b.at
  }
  const rest = kids.filter(c => !isVerifier(c) && c.startedAt >= from)
  if (v.status === 'running' || rest.length) out.push(stageOf(from, v.endedAt ?? now, undefined, bounds.length ? (v.status === 'running' ? 'current' : 'after the last verification') : 'current', v.status === 'running'))
  return out
}

/** The totals the headline, the pane and the done lines share. */
export function ledgerTotals(v: LedgerVersion, now: number) {
  const kids = Object.values(v.children)
  const by = (role: string) => kids.filter(c => roleOf(c.type) === role).length
  // WO-0220c: checks over ALL runs, redo and rejected over ALL marks ever recorded, attempts over the returned children's returns.
  const checkRuns = kids.flatMap(checksOf)
  const allMarks = kids.flatMap(marksOf)
  const runs = Object.values(v.runs)
  const withClone = kids.filter(c => c.merge !== undefined)
  const childTokens = kids.reduce((n, c) => n + c.tokens, 0)
  const sessions = Object.values(v.orchestrator)
  const intakeTokens = v.intake?.tokens ?? 0
  const orchTokens = sessions.reduce((n, s) => n + s.tokens, 0) + intakeTokens
  const wakes = Object.values(v.wakes).sort((a, b) => a.at - b.at)
  const vers = Object.values(v.verifications).sort((a, b) => a.at - b.at)
  const verifierWords = vers.filter(x => x.counts).map(x => `${x.stage} ${x.counts!.verdict === 'none' ? 'returned' : x.counts!.verdict} ${x.counts!.pass}/${x.counts!.pass + x.counts!.fail}`)
  const verifierShort = vers.filter(x => x.counts).map(x => `${x.counts!.pass}/${x.counts!.pass + x.counts!.fail}`)
  return {
    children: kids.length, builders: by('builder'), verifiers: by('verifier'), integrators: by('integrator'),
    returned: kids.filter(returned).length, running: kids.filter(c => !returned(c)).length, attempts: kids.filter(returned).reduce((n, c) => n + attemptsOf(c), 0),
    redo: allMarks.filter(m => m.verdict === 'redo').length, rejected: allMarks.filter(m => m.verdict === 'rejected').length,
    checksPass: checkRuns.filter(x => x.status === 'pass').length, checksTotal: checkRuns.length,
    runsPass: runs.filter(r => r.status === 'pass').length, runsTotal: runs.length,
    merges: withClone.filter(c => c.merge?.startsWith('merged')).length, clones: withClone.length,
    tokens: childTokens + orchTokens, orchTokens, orchShare: pctT(orchTokens, childTokens + orchTokens), intakeTokens, intake: v.intake,
    // The last KNOWN context: a wake's first step has not reported one yet (proof 2: "ctx 0" at each wake start).
    peakCtx: Math.max(0, ...sessions.map(s => s.ctxMax), ...wakes.map(w => w.ctx)), lastCtx: [...wakes].reverse().find(w => w.ctx > 0)?.ctx ?? Math.max(0, ...sessions.map(s => s.ctxMax)),
    wakes: wakes.length, compactions: v.compactions, ms: (v.endedAt ?? now) - v.startedAt,
    verifierWords, verifierShort, finalSha: vers.filter(x => x.stage === 'final' && x.sha).slice(-1)[0]?.sha,
  }
}

/** The three headline lines of a version (the mock's "## Headline"). */
export function ledgerHeadline(v: LedgerVersion, now: number): string[] {
  const t = ledgerTotals(v, now)
  return [
    `${childrenWord(t.children)} (${plural(t.builders, 'builder')} · ${plural(t.verifiers, 'verifier')} · ${plural(t.integrators, 'integrator')}) · ${t.redo} redo · ${t.rejected} rejected · checks ${t.checksPass}/${t.checksTotal} PASS · integration ${t.runsPass}/${t.runsTotal} PASS`,
    `verifiers: ${t.verifierWords.length ? t.verifierWords.join(' · ') : 'none yet'} · merges ${t.merges}/${t.clones} · ${tok(t.tokens)} tokens (orchestrator ${tok(t.orchTokens)} = ${t.orchShare}${t.intake ? `, of which intake ${tok(t.intakeTokens)}` : ''})`,
    `${clockT(t.ms)} · ${plural(t.wakes, 'wake')} · peak context ${tok(t.peakCtx)} · ${plural(t.compactions, 'compaction')}`,
  ]
}

/** A work order's short name: the id a description starts with ("B3: --json flag" → B3, "n2 — render" → n2), else the description cut. */
const orderId = (desc: string) => /^([A-Za-z]{1,3}-?\d+[a-z]?)\s*[:\-—–]/.exec(desc)?.[1] ?? shortT(desc.replace(/\s*\[for [^\]]*\]$/, ''), 24)

function verifierCell(ver: LedgerVerification | undefined, now: number): string {
  if (!ver) return '—'
  const at = ver.sha ? ` @ ${ver.sha}` : ''
  if (!ver.verifierId) return `requested ${clockT(now - ver.at)} ago${at}`
  if (!ver.returnedAt) return `running${at}`
  if (!ver.counts || ver.counts.verdict === 'none') return `returned, no VERDICT line${at}`
  return `${ver.counts.verdict} ${ver.counts.pass}/${ver.counts.pass + ver.counts.fail}${ver.counts.na ? ` · ${ver.counts.na} N/A` : ''}${at}`
}

function renderVersion(v: LedgerVersion, now: number, stamp: string, intro: boolean): string {
  const t = ledgerTotals(v, now)
  const L: string[] = [`# orc ledger · ${stamp} · v${v.version} · cursor ${v.cursor} · ${v.status === 'done' ? `done${v.finalStatus ? ` (${shortT(v.finalStatus, 60)})` : ''}` : 'running'} · as of ${isoT(now)}`]
  if (intro) L.push('Written by the substrate. Every number here is PROVED: orc measured it. Nothing here is the orchestrator\'s count.', 'Reading these numbers is the orchestrator\'s job (ops/FINAL.md, "Numbers").')
  L.push('', '## Headline', ...ledgerHeadline(v, now), '', '## Stages', '| stage | window | children | tokens | minutes | checks | redo | verifier | progress signal |', '|---|---|---|---|---|---|---|---|---|')
  const stages = ledgerStages(v, now)
  if (!stages.length) L.push('| (no stage yet) | — | — | — | — | — | — | — | none declared |')
  for (const s of stages) {
    const names = s.children.map(c => roleOf(c.type) === 'integrator' ? 'integrator' : orderId(c.description)).join(', ') || 'none'
    L.push(`| ${s.name} | ${hm(s.from)} → ${s.open ? 'now' : hm(s.to)} | ${cell(names)} | ${tok(s.tokens)} | ${Math.max(0, Math.round((s.to - s.from) / 60000))} | ${s.checks.total ? `${s.checks.pass}/${s.checks.total}` : 'none'} | ${s.redo} | ${cell(verifierCell(s.verification, now))} | none declared |`)
  }
  L.push('', '## Children', '| id | role | work order | took | attempts | tools | tokens | check (substrate) | boundary | merge | orchestrator\'s mark (READ) |', '|---|---|---|---|---|---|---|---|---|---|---|')
  const kids = Object.values(v.children).sort((a, b) => a.startedAt - b.startedAt)
  const byVerifier = new Map(Object.values(v.verifications).filter(x => x.verifierId).map(x => [x.verifierId!, x]))
  if (!kids.length) L.push('| (no children yet) | — | — | — | — | — | — | — | — | — | — |')
  for (const c of kids) {
    const ver = byVerifier.get(c.id)
    const order = ver ? `${ver.stage}${ver.sha ? ` @ ${ver.sha}` : ''}` : c.description.replace(/\s*\[for [^\]]*\]$/, '')
    const took = c.status === 'running' ? `running ${clockT(now - c.startedAt)}` : clockT((c.endedAt ?? now) - c.startedAt)
    // WO-0220c: every run of the check and every mark (`FAIL 1s → PASS 1s (2 runs)`, `redo → accepted: "…"`).
    const mark = markCell(c) ?? (c.status === 'running' ? '—' : 'UNMARKED')
    L.push(`| ${c.id.slice(0, 7)} | ${roleOf(c.type)} | ${cell(shortT(order, 48))} | ${took} | ${attemptsOf(c) || '—'} | ${c.toolCalls} | ${tok(c.tokens)} | ${cell(checkCell(c))} | ${c.boundary ?? '—'} | ${c.merge ?? '—'} | ${cell(mark)} |`)
  }
  L.push('', '## Verifications', '| id | stage | commit | criteria | verdict | defects | report |', '|---|---|---|---|---|---|---|')
  const vers = Object.values(v.verifications).sort((a, b) => a.at - b.at)
  if (!vers.length) L.push('| (none requested) | — | — | — | — | — | — |')
  for (const x of vers) {
    const cnt = x.counts
    L.push(`| ${(x.verifierId ?? x.id).slice(0, 7)} | ${x.stage} | ${x.sha ?? '—'} | ${cnt ? `${cnt.pass} PASS · ${cnt.fail} FAIL · ${cnt.na} N/A` : x.returnedAt ? 'no CRITERIA lines' : x.verifierId ? 'running' : 'requested'} | ${cnt ? cnt.verdict : '—'} | ${cnt ? cnt.defects : '—'} | ${x.reportPath ?? '—'} |`)
  }
  L.push('', '## Integration runs', '| at | after | status | took | load |', '|---|---|---|---|---|')
  const runs = Object.values(v.runs).sort((a, b) => a.at - b.at)
  if (!runs.length) L.push('| (none yet) | — | — | — | — |')
  for (const r of runs) L.push(`| ${hms(r.at)} | ${cell(shortT(r.after, 30))} merge | ${r.status.toUpperCase()} | ${clockT(r.ms)} | ${r.load !== undefined && r.cores ? `${r.load} / ${r.cores}` : '—'} |`)
  L.push('', '## Wakes (the orchestrator\'s own cost)', '| # | at | why | context then | that turn | marks made |', '|---|---|---|---|---|---|')
  const wakes = Object.values(v.wakes).sort((a, b) => a.at - b.at)
  if (!wakes.length) L.push('| — | — | (no wake yet) | — | — | — |')
  const row = (w: LedgerWake, i: number) => `| ${i + 1} | ${hms(w.at)} | ${cell(w.why)} | ${tok(w.ctx)} | ${tok(w.inTokens)} in · ${tok(w.outTokens)} out · ${w.steps} steps | ${w.marks.join(', ') || '—'} |`
  if (wakes.length <= 80) wakes.forEach((w, i) => L.push(row(w, i)))
  else { wakes.slice(0, 10).forEach((w, i) => L.push(row(w, i))); L.push(`| … | | ${wakes.length - 60} more | | | |`); wakes.slice(-50).forEach((w, i) => L.push(row(w, wakes.length - 50 + i))) }
  L.push(`orchestrator totals: ${tok(t.orchTokens)} tokens over ${plural(t.wakes, 'wake')} · peak context ${tok(t.peakCtx)} · ${plural(t.compactions, 'compaction')}${Object.keys(v.orchestrator).length > 1 ? ` · ${Object.keys(v.orchestrator).length} sessions` : ''}`)
  L.push(intakeLine(v.intake))
  return L.join('\n')
}

/** The intake's own line under the wakes' totals: what the interview and the gates cost before approval. */
export const intakeLine = (i: LedgerIntake | undefined) => (i ? `intake: ${plural(i.requests, 'request')} · ${tok(i.tokens)} · ${clockT(i.ms)} (before approval)` : 'intake: not recorded in this session')

/** The instant a version's ledger text is "as of": its end when done, else now (renderLedger and stampReport agree). */
export const ledgerAsOf = (v: LedgerVersion, now: number) => (v.status === 'done' && v.endedAt ? v.endedAt : now)

/** ops/orc/LEDGER.md: one block per version, the latest first and the mock's sections in the mock's order. */
export function renderLedger(l: Ledger, now: number): string {
  const name = l.repo.replace(/\/+$/, '').replace(/.*\//, '') || l.repo
  const versions = [...l.versions].sort((a, b) => b.version - a.version)
  if (!versions.length) return `# orc ledger · ${name} · as of ${isoT(now)}\nWritten by the substrate. No mission has run yet.\n`
  return versions.map((v, i) => renderVersion(v, ledgerAsOf(v, now), name, i === 0)).join('\n\n---\n\n') + '\n'
}

/** The four lines the owner reads at done: status · PROVED · READ · ledger. The toast carries the first two. */
/** The verdict word and commit of the done line (WO-0220c): the last final verification's parsed VERDICT and its
 *  snapshot's commit; only without one (none requested, none returned, or no VERDICT line) the STATUS text, shortened
 *  and never repeating "DONE" (proof 2 printed "DONE · DONE — final verificati…"). */
export function doneVerdict(v: LedgerVersion, status: string): { word: string; sha?: string } {
  const fin = Object.values(v.verifications).filter(x => x.stage === 'final').sort((a, b) => a.at - b.at).slice(-1)[0]
  const finalSha = Object.values(v.verifications).filter(x => x.stage === 'final' && x.sha).sort((a, b) => a.at - b.at).slice(-1)[0]?.sha
  if (fin?.counts && fin.counts.verdict !== 'none') return { word: fin.counts.verdict, sha: fin.sha ?? finalSha }
  const text = status.replace(/\*\*/g, '').replace(/^\s*STATUS:\s*/i, '').replace(/^(?:DONE\b[\s—–:·,.-]*)+/i, '').trim()
  const word = /\b(PASS|FAIL)(?:ED)?\b/i.exec(text)?.[1]?.toUpperCase() ?? shortT(text, 24)
  return { word, sha: finalSha ?? /\b[0-9a-f]{7,12}\b/.exec(status)?.[0]?.slice(0, 7) }
}

export function ledgerDoneLines(v: LedgerVersion, now: number, o: { status: string; reading?: string }): string[] {
  const t = ledgerTotals(v, now)
  const { word, sha } = doneVerdict(v, o.status)
  const verdict = [word, sha ? `at ${sha}` : ''].filter(Boolean).join(' ')
  return [
    [`mission v${v.version} DONE`, verdict, clockT(t.ms)].filter(Boolean).join(' · '),
    `PROVED  ${childrenWord(t.children)} · checks ${t.checksPass}/${t.checksTotal} · verifiers ${t.verifierShort.length ? t.verifierShort.join(', ') : 'none'} · ${t.redo} redo · ${tok(t.tokens)} (orchestrator ${t.orchShare}) · peak context ${tok(t.peakCtx)}`,
    `READ    ${o.reading ? `"${shortT(o.reading, 110)}"` : '(no READING: line in ops/FINAL.md)'}`,
    'ledger  ops/orc/LEDGER.md · report ops/FINAL.md',
  ]
}

export const NO_CHECK_LINE = 'PROVED  nothing this stage — no registered check ran; see CLAIMED in the report'
/** The live PROVED line while the mission runs, and whether the stage so far has nothing proved (shown in yellow). */
export function ledgerLiveLine(v: LedgerVersion, now: number): { text: string; warn: boolean } {
  const t = ledgerTotals(v, now)
  const stages = ledgerStages(v, now)
  const open = stages[stages.length - 1]
  const closed = stages.length > 1 ? stages[stages.length - 2] : undefined
  const openReturned = open ? open.children.filter(returned) : []
  const warn = open ? (openReturned.length > 0 ? open.checks.total === 0 : !!closed && closed.children.some(returned) && closed.checks.total === 0) : false
  return { warn, text: warn ? NO_CHECK_LINE : `PROVED so far  ${t.returned} returned${t.attempts > t.returned ? ` (${t.attempts} attempts)` : ''} · checks ${t.checksPass}/${t.checksTotal} · ${t.redo} redo · ${tok(t.tokens)} · ${Math.round(t.ms / 60000)} min · ctx ${tok(t.lastCtx)} · ${plural(t.wakes, 'wake')}` }
}
