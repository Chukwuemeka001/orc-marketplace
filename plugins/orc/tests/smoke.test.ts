// Smoke tests for what a stranger meets first. Run: claude plugin test <plugin-dir>
import { test, expect, describe } from 'claude-code/testing'
import { ownReadRoot, sweepsStage, shellMask, browserGranted, computerOf, sandboxSettingsFor, browserCallAllowed, SAFE_BROWSER_TOOLS, UNSAFE_BROWSER_TOOLS, continueRefusal, doneSection } from '../hooks/policy'

describe('outside the lab', () => {
  test('/orc demo is a lab feature', async ($) => {
    const r = await $.command.run({ command: 'orc', args: 'demo' })
    expect(r.text ?? '').toContain('lab feature')
  })

  test('/orc study is a lab feature', async ($) => {
    const r = await $.command.run({ command: 'orc', args: 'study' })
    expect(r.text ?? '').toContain('lab feature')
  })
})

describe('reads orc allows without a dialog', () => {
  const running = { status: 'running', repo: '/work/app' }
  const out = '/home/u/.claude/orc'

  test('a read in a clone orc cut for the running mission', async () => {
    expect(ownReadRoot('Read', { file_path: '/work/app-wt/build-x-k1/units.py' }, running, out, '/home/u')).toBe('/work/app-wt')
  })
  test('a relay prompt in orc\'s data folder, also written with ~', async () => {
    expect(ownReadRoot('Read', { file_path: '/home/u/.claude/orc/relay-spawn-verifier-1.md' }, running, out, '/home/u')).toBe(out)
    expect(ownReadRoot('Read', { file_path: '~/.claude/orc/relay-spawn-verifier-1.md' }, running, out, '/home/u')).toBe(out)
  })
  test('Grep and Glob in a clone', async () => {
    expect(ownReadRoot('Grep', { path: '/work/app-wt/x' }, running, out, '/home/u')).toBe('/work/app-wt')
    expect(ownReadRoot('Glob', { path: '/work/app-wt' }, running, out, '/home/u')).toBe('/work/app-wt')
  })
})

describe('everything else stays with Claude Code', () => {
  const running = { status: 'running', repo: '/work/app' }
  const out = '/home/u/.claude/orc'

  test('a read outside orc\'s folders', async () => {
    expect(ownReadRoot('Read', { file_path: '/etc/hosts' }, running, out, '/home/u')).toBeUndefined()
    expect(ownReadRoot('Read', { file_path: '/work/app-wtx/file' }, running, out, '/home/u')).toBeUndefined()
  })
  test('any write or shell command, even in a clone', async () => {
    expect(ownReadRoot('Write', { file_path: '/work/app-wt/x/f.py' }, running, out, '/home/u')).toBeUndefined()
    expect(ownReadRoot('Edit', { file_path: '/work/app-wt/x/f.py' }, running, out, '/home/u')).toBeUndefined()
    expect(ownReadRoot('Bash', { file_path: '/work/app-wt/x/f.py' }, running, out, '/home/u')).toBeUndefined()
  })
  test('a path that climbs out with ..', async () => {
    expect(ownReadRoot('Read', { file_path: '/work/app-wt/../secrets.txt' }, running, out, '/home/u')).toBeUndefined()
  })
  test('no running mission', async () => {
    expect(ownReadRoot('Read', { file_path: '/work/app-wt/x' }, { status: 'done', repo: '/work/app' }, out, '/home/u')).toBeUndefined()
    expect(ownReadRoot('Read', { file_path: '/work/app-wt/x' }, null, out, '/home/u')).toBeUndefined()
  })
  test('a relative path', async () => {
    expect(ownReadRoot('Read', { file_path: 'app-wt/x' }, running, out, '/home/u')).toBeUndefined()
  })
})

describe('the sweep guard reads commands, not quoted text', () => {
  test('real sweeping stages are caught', async () => {
    expect(sweepsStage('git add -A')).toBe(true)
    expect(sweepsStage('cd repo && git add . && git commit -m x')).toBe(true)
    expect(sweepsStage('git commit -am "msg"')).toBe(true)
    expect(sweepsStage("cat > f <<'EOF'\nhello\nEOF\ngit add -A")).toBe(true)
  })
  test('naming paths is fine', async () => {
    expect(sweepsStage('git add ops/CONTRACTS.md && git commit -m "ops: contracts"')).toBe(false)
  })
  test('a work order that quotes the forbidden flags is text (Desktop run 2026-10-08)', async () => {
    expect(sweepsStage("MUST='## Must not\n- never run `git add -A` or `git commit -a`'\nprintf '%s' \"$MUST\" > ops/work-orders/n1.md")).toBe(false)
    expect(sweepsStage("cat > ops/work-orders/n1.md <<'EOF'\nNever git add -A.\nEOF")).toBe(false)
    expect(sweepsStage('git commit -m "explain why -a is denied"')).toBe(false)
    expect(sweepsStage('echo "use git add . carefully"')).toBe(false)
  })
  test('masking keeps positions', async () => {
    const { code, masked } = shellMask('git add "my file.txt" b.txt')
    expect(masked.length).toBe(code.length)
    expect(code.slice(8, 21)).toBe('"my file.txt"')
  })
})

describe('the orc computer', () => {
  const plan = (caps: { need: string; by: string }[]) => ({ repo: '/work/site', understanding: { executionPolicy: { capabilities: caps.map(c => ({ ...c, why: 'x' })) } } })
  test('a browser granted to verifiers goes to verifiers only', async () => {
    const m = plan([{ need: 'headless browser on http://localhost', by: 'verifier' }])
    expect(browserGranted(m, 'verifier')).toBe(true)
    expect(browserGranted(m, 'builder')).toBe(false)
    expect(computerOf(m).browser).toEqual(['verifier'])
  })
  test('no capabilities: no browser, no network, writes to repo and clones', async () => {
    const c = computerOf(plan([]))
    expect(c.browser).toEqual([])
    expect(c.hosts).toEqual([])
    expect(c.workspace).toEqual(['/work/site', '/work/site-wt'])
  })
  test('hosts the plan names become the allowed domains', async () => {
    const m = plan([{ need: 'network: api.github.com for release notes', by: 'builder' }, { need: 'browser at localhost', by: 'builder' }])
    expect(computerOf(m).hosts).toEqual(['api.github.com'])
    const sb = sandboxSettingsFor(m) as { enabled: boolean; allowUnsandboxedCommands: boolean; filesystem: { allowWrite: string[] }; network: { allowLocalBinding: boolean; allowedDomains: string[] } }
    expect(sb.enabled).toBe(true)
    expect(sb.allowUnsandboxedCommands).toBe(false)
    expect(sb.filesystem.allowWrite).toEqual(['/work/site-wt'])
    expect(sb.network.allowLocalBinding).toBe(true)
    expect(sb.network.allowedDomains).toEqual(['api.github.com'])
  })
})

describe('the browser tools a worker may hold', () => {
  test('page tools are allowed', async () => {
    for (const t of ['browser_navigate', 'browser_resize', 'browser_evaluate', 'browser_snapshot', 'browser_take_screenshot']) expect(browserCallAllowed(`mcp__orc-browser__${t}`)).toBe(true)
  })
  test('tools that act outside the sandbox are withheld (v1 live test: a builder used run_code_unsafe)', async () => {
    for (const t of ['browser_run_code_unsafe', 'browser_file_upload', 'browser_drop']) expect(browserCallAllowed(`mcp__orc-browser__${t}`)).toBe(false)
    for (const t of UNSAFE_BROWSER_TOOLS) expect(SAFE_BROWSER_TOOLS.includes(t)).toBe(false)
  })
  test('another server\'s tools are never approved by this rule', async () => {
    expect(browserCallAllowed('mcp__other__browser_navigate')).toBe(false)
  })
})

describe('continuing a finished mission (/orc continue)', () => {
  const done = { status: 'done', mode: 'main', version: 1, understanding: { mission: {} } }
  test('a finished main-mode mission with a request continues', async () => {
    expect(continueRefusal(done, 'Continue through the rest of the phases until this is done')).toBeUndefined()
  })
  test('no mission, no request', async () => {
    expect(continueRefusal(null, 'more')).toContain('no mission')
    expect(continueRefusal(done, '   ')).toContain('say what comes next')
  })
  test('a running mission is steered, not continued', async () => {
    expect(continueRefusal({ ...done, status: 'running' }, 'more')).toContain('still running')
  })
  test('intake first, and a subagent-run mission goes through /orc start', async () => {
    expect(continueRefusal({ ...done, status: 'permission_requested' }, 'more')).toContain('intake')
    expect(continueRefusal({ ...done, understanding: undefined }, 'more')).toContain('neither an approved understanding nor a mission file')
    expect(continueRefusal({ ...done, understanding: undefined, missionFile: '/lab/MISSION.md' }, 'more')).toBeUndefined()
    expect(continueRefusal({ ...done, mode: 'subagent', missionFile: '/work/app/ops/orc/MISSION.md' }, 'more')).toContain('/orc start /work/app/ops/orc/MISSION.md')
  })
  test('the finished-mission section tells the orchestrator to continue under orc, never by hand', async () => {
    const t = doneSection({ repo: '/work/app', version: 2 })
    expect(t).toContain('/work/app')
    expect(t).toContain('mcp__orc__continue')
    expect(t).toContain('do not orchestrate by hand')
    expect(t).toContain('/orc backlog')
  })
  test('/orc continue with no mission in the session says so', async ($) => {
    const r = await $.command.run({ command: 'orc', args: 'continue add a --json flag' })
    expect(r.text ?? '').toContain('no mission')
  })
})
