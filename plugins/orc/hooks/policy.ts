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
export function doneSection(m: { repo: string; version: number }): string {
  return [
    `# orc: the mission in ${m.repo} is finished (v${m.version})`,
    'The orc plugin adds this section while a finished mission is loaded in this session. If the owner asks for more work on this repository, do not orchestrate by hand (no Agent calls for builders or verifiers, no commits that sweep staged files):',
    '- more of the same mission (the next phase, "continue until done", a follow-up): call mcp__orc__continue {request: <their words>} FIRST. It carries the approved understanding, plan, rules and standing directives into a new version under orc (clones, checks, verifiers, merges and the pane come back; no new interview or gate) and hands you the working rules as the next prompt.',
    '- a different goal: /orc backlog add <request> then /orc backlog next (a new intake with gates), or /orc begin <request>.',
    '- questions, reports and reading need nothing: just answer.',
  ].join('\n')
}
