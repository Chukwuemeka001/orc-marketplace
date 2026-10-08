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
