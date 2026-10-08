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
