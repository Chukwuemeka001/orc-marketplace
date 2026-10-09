// Smoke tests for what a stranger meets first. Run: claude plugin test <plugin-dir>
import { test, expect, describe } from 'claude-code/testing'
import { ownReadRoot, sweepsStage, shellMask, browserGranted, computerOf, sandboxSettingsFor, browserCallAllowed, SAFE_BROWSER_TOOLS, UNSAFE_BROWSER_TOOLS, continueRefusal, doneSection, verifierCounts, finalReportShape, checkpointReportShape, stampReport, intakeOf, intakeLine, wakeWhy, projectLedger, mergeLedger, renderLedger, ledgerHeadline, ledgerStages, ledgerLiveLine, ledgerDoneLines, NO_CHECK_LINE, ledgerTotals, doneVerdict, settleBlock, withTurnUsage, closedTurn, checkCell, markCell } from '../hooks/policy'
import type { OrcAgent, OrcTurn } from '../types'

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

// ---- 0.22.0: the numbers beside the reading ------------------------------------------------------------------------

const VERIFIER_REPORT = `VERDICT: FAIL (commit 5ea33f8058a0). sharpe_r returns a huge number instead of null. Everything else passed.

CRITERIA:
- PASS 1 unittest suite and fixtures — python3.11 -m unittest discover -s tests → 122 tests OK
- PASS 2 import — import of the fixtures → imported 4, skipped 0
- **PASS** 3 performance — scripts/perf_stats.py → 1.768 s for 200,000 trades
- FAIL A2 more statistics — stats --by tag --json → sharpe_r is 15922629181314.432 rather than null
- N/A A5 browser check — no browser granted

DEFECTS:
1. stats --by tag --json on tests/fixtures/native_tags.csv → sharpe_r should be null when R has zero deviation

NOT CHECKED:
- the breakeven trade directly`

describe('a verifier\'s report is counted by the substrate', () => {
  test('VERDICT, CRITERIA and DEFECTS lines (bullets and bold allowed)', async () => {
    expect(verifierCounts(VERIFIER_REPORT)).toEqual({ verdict: 'FAIL', pass: 3, fail: 1, na: 1, defects: 1 })
  })
  test('a short PASS with "DEFECTS: none"', async () => {
    expect(verifierCounts('VERDICT: PASS (commit b750d1f)\nDEFECTS: none\nNOT CHECKED: strings as inputs.')).toEqual({ verdict: 'PASS', pass: 0, fail: 0, na: 0, defects: 0 })
  })
  test('no verdict line at all', async () => {
    expect(verifierCounts('I ran the tests and they look fine.').verdict).toBe('none')
  })
})

const FINAL_OK = `# Final report
STATUS: PASS (final verification passed at commit b0ee8e9)
READING: the --json flag shipped as specified; a nan/inf traceback was fixed (B4) before final verification.
NUMBERS: ops/orc/LEDGER.md

## Numbers
PROVED (ledger): 5 children · 0 redo · checks 3/3 PASS · checkpoint 6/6 · final 10/10
CLAIMED (reports): B3 "16 tests OK" (main-a60ad8f.md)
READ: both builders landed first time.

## What was built
...`

describe('the final report\'s shape is checked before a final verification', () => {
  test('the full shape passes', async () => {
    expect(finalReportShape(FINAL_OK)).toEqual([])
  })
  test('the PROVED line is optional in the draft: the substrate stamps it (WO-0220b)', async () => {
    expect(finalReportShape(FINAL_OK.replace(/^PROVED.*\n/m, ''))).toEqual([])
  })
  test('a missing READING: line is named', async () => {
    const missing = finalReportShape(FINAL_OK.replace(/^READING:.*\n/m, ''))
    expect(missing.length).toBe(1)
    expect(missing[0]).toContain('READING:')
  })
  test('a missing section, a section without its READ line, one without its CLAIMED line', async () => {
    expect(finalReportShape(FINAL_OK.replace('## Numbers', '## Figures')).join(' ')).toContain('"## Numbers" section')
    const noRead = finalReportShape(FINAL_OK.replace(/^READ:.*\n/m, ''))
    expect(noRead).toEqual(['READ line in "## Numbers" (your sentence)'])
    const noClaimed = finalReportShape(FINAL_OK.replace(/^CLAIMED.*\n/m, ''))
    expect(noClaimed.length).toBe(1)
    expect(noClaimed[0]).toContain('CLAIMED line')
  })
  test('an empty draft lacks everything; a checkpoint only warns about NUMBERS:; no line mentions a cursor', async () => {
    const all = finalReportShape('')
    expect(all.length).toBe(4)
    expect(all.join(' ')).not.toContain('cursor')
    expect(checkpointReportShape('# CHECKPOINT-1\nNUMBERS: ops/orc/LEDGER.md\n')).toEqual([])
    const missing = checkpointReportShape('# CHECKPOINT-1\ncovers n1..n3\n')
    expect(missing.length).toBe(1)
    expect(missing[0]).not.toContain('cursor')
  })
})

describe('the substrate stamps the report\'s PROVED figures (WO-0220b)', () => {
  const HEAD = ['5 children (2 builders · 2 verifiers · 1 integrator) · 0 redo · 0 rejected · checks 3/3 PASS · integration 2/2 PASS', 'verifiers: checkpoint PASS 6/6 · final PASS 10/10 · merges 2/2 · 1.93M tokens (orchestrator 0.79M = 41%)', '9m12 · 5 wakes · peak context 212k · 0 compactions']
  const AT = Date.UTC(2026, 9, 9, 13, 1, 30)
  const OLD = FINAL_OK.replace('NUMBERS: ops/orc/LEDGER.md', 'NUMBERS: ops/orc/LEDGER.md @ cursor 5')
  test('NUMBERS: and the section\'s PROVED line are replaced; every other line is left as it was', async () => {
    const { text, stamped } = stampReport(OLD, HEAD, AT)
    expect(stamped).toEqual(['NUMBERS', 'PROVED'])
    expect(text).toContain('NUMBERS: ops/orc/LEDGER.md @ 2026-10-09T13:01:30Z (stamped by the substrate)')
    expect(text).toContain(`PROVED (ledger): ${HEAD.join(' · ')}`)
    expect(text).not.toContain('@ cursor')
    expect(text).not.toContain('checkpoint 6/6 · final 10/10')
    const before = OLD.split('\n'), after = text.split('\n')
    expect(after.length).toBe(before.length)
    before.forEach((l, i) => { if (!/^(NUMBERS:|PROVED)/.test(l)) expect(after[i]).toBe(l) })
  })
  test('a draft without a PROVED line gets one as the section\'s first line', async () => {
    const draft = FINAL_OK.replace(/^PROVED.*\n/m, '')
    const { text, stamped } = stampReport(draft, HEAD, AT)
    expect(stamped).toEqual(['NUMBERS', 'PROVED'])
    const lines = text.split('\n')
    expect(lines[lines.indexOf('## Numbers') + 1]).toBe(`PROVED (ledger): ${HEAD.join(' · ')}`)
    expect(lines.length).toBe(draft.split('\n').length + 1)
  })
  test('a checkpoint without the section: only NUMBERS: is stamped; a bare PROVED (ledger): line is still replaced', async () => {
    const cp = stampReport('# CHECKPOINT-1\nNUMBERS: ops/orc/LEDGER.md\ncovers n1..n3\n', HEAD, AT)
    expect(cp.stamped).toEqual(['NUMBERS'])
    expect(cp.text).toBe('# CHECKPOINT-1\nNUMBERS: ops/orc/LEDGER.md @ 2026-10-09T13:01:30Z (stamped by the substrate)\ncovers n1..n3\n')
    const bare = stampReport('# CHECKPOINT-2\nNUMBERS: x\nPROVED (ledger): 1 child\n', HEAD, AT)
    expect(bare.stamped).toEqual(['NUMBERS', 'PROVED'])
    expect(bare.text.split('\n')[2]).toBe(`PROVED (ledger): ${HEAD.join(' · ')}`)
  })
  test('bold and bulleted forms are recognised, a report with neither line is left alone, and stamping twice is idempotent', async () => {
    const bold = stampReport('**NUMBERS:** old\n\n## Numbers\n- **PROVED (ledger):** old\n- CLAIMED (reports): x\n', HEAD, AT)
    expect(bold.stamped).toEqual(['NUMBERS', 'PROVED'])
    expect(bold.text.split('\n')[0]).toContain('(stamped by the substrate)')
    expect(bold.text.split('\n')[3]).toBe(`PROVED (ledger): ${HEAD.join(' · ')}`)
    const none = stampReport('# plain\nnothing here\n', HEAD, AT)
    expect(none.stamped).toEqual([])
    expect(none.text).toBe('# plain\nnothing here\n')
    const once = stampReport(FINAL_OK, HEAD, AT).text
    expect(stampReport(once, HEAD, AT).text).toBe(once)
  })
})

describe('why the orchestrator woke, read from the prompt', () => {
  test('the engine\'s prefix before the inbox block is tolerated', async () => {
    const text = 'The orc plugin sent a message: orc inbox (automatic) — [orc inbox] 1 item(s) for the main session. Act on each as the working rules say, then end the turn:\n\n1. (ib-abc12, wake) [orc wake] cursor 3 · 2026-10-09T12:56:40Z · orchestrator main\nSTATE: repo /r · phase pre-checkpoint · children 1\nRETURNED: a60ad8fdd0848c158 "B3: --json flag, tests, README" (builder) returned after 5m03, 31 tool calls · check PASS'
    expect(wakeWhy(text)).toBe('B3: --json flag, tests, README returned')
  })
  test('a verifier, an integration result, a graph ping; and a plain prompt is not a wake', async () => {
    expect(wakeWhy('[orc wake] cursor 4\nRETURNED: a02a8134cbca86456 "auto verifier: checkpoint [for main]" (verifier) returned after 1m20')).toBe('checkpoint verifier returned')
    expect(wakeWhy('[orc wake] cursor 5\nSTATE: x\nALSO CHANGED:\n• integration check after merge of B3: PASS')).toBe('integration result')
    expect(wakeWhy('[orc graph] gate g1 (final) reached: n1, n2 passed.')).toContain('graph: gate g1')
    expect(wakeWhy('please add a README')).toBeUndefined()
  })
})

// The conttest v2 children (the design mock's own run), with the mock's shape.
const T = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 9, h, m, s)
const agent = (a: Partial<OrcAgent> & { id: string; type: string; description: string; startedAt: number }): OrcAgent => ({
  status: 'completed', toolCalls: 0, toolErrors: 0, promptChars: 0, steps: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, parentId: 'main',
  classes: {}, activities: {}, tools: [], outProseChars: 0, outThinkChars: 0, outArgChars: 0, ctxTokens: 0, ctxMax: 0, ctxFirst: 0, children: 0, runs: 1, ...a,
})
const turn = (t: Partial<OrcTurn> & { turnId: string; startedAt: number; wake: string }): OrcTurn => ({ n: 0, prompt: '', steps: 3, modelMs: 0, contextTokens: 0, outputTokens: 0, outProseChars: 0, outThinkChars: 0, outArgChars: 0, classes: {}, activities: {}, tools: [], spawned: [], finished: [], ...t })
const pass = (tail: string, ms = 1000) => ({ status: 'pass' as const, exitCode: 0, ms, outputTail: tail })
const kids: OrcAgent[] = [
  agent({ id: 'a60ad8fdd0848c158', type: 'orc:builder', description: 'B3: --json flag, tests, README', startedAt: T(12, 51, 30), endedAt: T(12, 56, 33), toolCalls: 31, inputTokens: 162, outputTokens: 5057, cacheReadTokens: 388000, cacheWriteTokens: 18908, checkResult: pass('Ran 16 tests in 0.518s\n\nOK'), boundaryReport: { outside: [], othersRunning: [], checkedAt: T(12, 56, 34) }, worktree: { path: '/r-wt/b3', branch: 'wt/b3', base: '/r', merged: 'merged', mergeSha: 'e7147cd' }, mark: { verdict: 'accepted', note: 'Registered check PASS; spot-checked imports, diff, README', at: T(12, 56, 50) }, reportPath: '/h/.claude/orc/ledger/main-a60ad8f.md' }),
  agent({ id: 'a02a8134cbca86456', type: 'orc:verifier', description: 'auto verifier: checkpoint [for main]', startedAt: T(12, 57, 10), endedAt: T(12, 58, 30), toolCalls: 14, outputTokens: 2058, cacheReadTokens: 188000, verifierCounts: { verdict: 'PASS', pass: 6, fail: 0, na: 0, defects: 0 }, mark: { verdict: 'accepted', note: 'PASS on 6 criteria; outside scope I found nan/inf traceback → B4', at: T(12, 58, 40) }, reportPath: '/h/.claude/orc/ledger/main-a02a813.md' }),
  agent({ id: 'aff93f6bbedfb1bb9', type: 'orc:builder', description: 'B4: reject non-finite values', startedAt: T(12, 58, 40), endedAt: T(12, 59, 37), toolCalls: 12, outputTokens: 3703, cacheReadTokens: 156000, checkResult: pass('Ran 19 tests in 0.678s\n\nOK'), boundaryReport: { outside: [], othersRunning: [], checkedAt: T(12, 59, 38) }, worktree: { path: '/r-wt/b4', branch: 'wt/b4', base: '/r', merged: 'merged', mergeSha: '2b1c0aa' }, mark: { verdict: 'accepted', note: 'check PASS; diff is import math + 3-line guard', at: T(12, 59, 50) } }),
  agent({ id: 'ad14d261c9fee584d', type: 'orc:integrator', description: 'auto integrator: requested after the amendment [for main]', startedAt: T(12, 59, 40), endedAt: T(13, 1, 22), toolCalls: 9, outputTokens: 4713, cacheReadTokens: 195000, checkResult: pass('PASS 5 json: README.md documents --json\nINTEGRATION: PASS'), boundaryReport: { outside: [], othersRunning: ['ops/orc/state.json (orchestrator\'s own ops/)'], checkedAt: T(13, 1, 23) }, mark: { verdict: 'accepted', note: '33 PASS lines', at: T(13, 1, 28) } }),
  agent({ id: 'ac180a60d220096ee', type: 'orc:verifier', description: 'auto verifier: final [for main]', startedAt: T(13, 1, 40), endedAt: T(13, 2, 34), toolCalls: 11, outputTokens: 2800, cacheReadTokens: 177000, verifierCounts: { verdict: 'PASS', pass: 10, fail: 0, na: 0, defects: 0 }, mark: { verdict: 'accepted', note: 'PASS on 10 criteria; matches my spot-checks', at: T(13, 2, 40) } }),
]
const orch = agent({ id: 'main', type: 'orc:orchestrator', description: 'orchestrator (main session)', startedAt: T(12, 51), status: 'running', parentId: undefined, cursor: 5, inputTokens: 706, outputTokens: 19795, cacheReadTokens: 722000, cacheWriteTokens: 47058, ctxMax: 212000,
  verifyRequests: [{ id: 'vr-checkpoint-1', stage: 'checkpoint', at: T(12, 57), repo: '/r', snapshot: '/r-wt/verify-checkpoint-e7147cd-k1a2b' }, { id: 'vr-final-2', stage: 'final', at: T(13, 1, 30), repo: '/r', snapshot: '/r-wt/verify-final-b0ee8e9-k9z8y' }],
  integration: { repo: '/r', runs: [{ at: T(12, 56, 50), after: 'B3: --json flag, tests, README', status: 'pass', exitCode: 0, ms: 1055, tail: 'INTEGRATION: PASS', reported: true, load: 5.5, cores: 8 }, { at: T(12, 59, 20), after: 'B4: reject non-finite values', status: 'pass', exitCode: 0, ms: 1221, tail: 'INTEGRATION: PASS', reported: true, load: 7, cores: 8 }], dispatches: [] } })
const turns: OrcTurn[] = [
  turn({ turnId: 't1', startedAt: T(12, 56, 40), endedAt: T(12, 57, 5), wake: 'B3: --json flag, tests, README returned', contextTokens: 148000, inTokens: 161000, outputTokens: 3100, steps: 4 }),
  turn({ turnId: 't2', startedAt: T(12, 58, 35), endedAt: T(12, 58, 45), wake: 'checkpoint verifier returned', contextTokens: 171000, inTokens: 180000, outputTokens: 2400 }),
  turn({ turnId: 't3', startedAt: T(12, 59, 38), endedAt: T(12, 59, 55), wake: 'B4: reject non-finite values returned', contextTokens: 180000, inTokens: 190000, outputTokens: 2000 }),
  turn({ turnId: 't4', startedAt: T(13, 1, 25), endedAt: T(13, 1, 29), wake: 'integrator returned', contextTokens: 195000, inTokens: 200000, outputTokens: 1500 }),
  turn({ turnId: 't5', startedAt: T(13, 2, 36), endedAt: T(13, 2, 50), wake: 'final verifier returned', contextTokens: 212000, inTokens: 220000, outputTokens: 2600 }),
]
const NOW = T(13, 3)
const src = (over: Partial<Parameters<typeof projectLedger>[0]> = {}) => projectLedger({ version: 2, startedAt: T(12, 51), now: NOW, status: 'done', finalStatus: 'STATUS: PASS (final verification passed at commit b0ee8e9)', sessionId: 's1', orch, kids, turns, compactions: 0, ...over })

describe('the ledger: the substrate\'s numbers, projected from its own records', () => {
  test('headline: children by role, checks, integration, verifiers, merges, tokens, wakes, peak context', async () => {
    const [l1, l2, l3] = ledgerHeadline(src(), NOW)
    expect(l1).toBe('5 children (2 builders · 2 verifiers · 1 integrator) · 0 redo · 0 rejected · checks 3/3 PASS · integration 2/2 PASS')
    expect(l2).toContain('verifiers: checkpoint PASS 6/6 · final PASS 10/10 · merges 2/2 · ')
    expect(l2).toContain('tokens (orchestrator 0.79M = ')
    expect(l3).toBe('12m00 · 5 wakes · peak context 212k · 0 compactions')
  })
  test('stages are the windows between verification requests, with their checks and their verifier', async () => {
    const st = ledgerStages(src(), NOW)
    expect(st.map(s => s.name)).toEqual(['to checkpoint 1', 'to final'])
    expect(st[0]!.children.map(c => c.id.slice(0, 7))).toEqual(['a60ad8f'])
    expect(st[1]!.children.map(c => c.id.slice(0, 7))).toEqual(['aff93f6', 'ad14d26'])
    expect(st[0]!.checks).toEqual({ pass: 1, total: 1 })
    expect(st[1]!.checks).toEqual({ pass: 2, total: 2 })
    expect(st[0]!.verification?.sha).toBe('e7147cd')
    expect(st[0]!.verification?.counts?.pass).toBe(6)
  })
  test('the rendered file keeps the mock\'s sections, columns and order', async () => {
    const md = renderLedger(mergeLedger(undefined, src(), '/Users/x/units', NOW), NOW)
    const order = ['# orc ledger · units · v2 · cursor 5', 'Every number here is PROVED', '## Headline', '## Stages', '| stage | window | children | tokens | minutes | checks | redo | verifier | progress signal |', '| to checkpoint 1 | 12:51 → 12:57 | B3 | 0.60M | 6 | 1/1 | 0 | PASS 6/6 @ e7147cd | none declared |', '| to final | 12:57 → 13:01 | B4, integrator | 0.54M | 5 | 2/2 | 0 | PASS 10/10 @ b0ee8e9 | none declared |', '## Children', '| id | role | work order | took | attempts | tools | tokens | check (substrate) | boundary | merge | orchestrator\'s mark (READ) |', '| a60ad8f | builder | B3: --json flag, tests, README | 5m03 | 1 | 31 | 412k | PASS 1s · "Ran 16 tests in 0.518s · OK" | clean | merged e7147cd | accepted: "Registered check PASS; spot-checked imports, diff, README" |', '| a02a813 | verifier | checkpoint @ e7147cd | 1m20 | 1 | 14 |', '## Verifications', '| a02a813 | checkpoint | e7147cd | 6 PASS · 0 FAIL · 0 N/A | PASS | 0 | /h/.claude/orc/ledger/main-a02a813.md |', '## Integration runs', '| 12:56:50 | B3: --json flag, tests, README merge | PASS | 1s | 5.5 / 8 |', '## Wakes (the orchestrator\'s own cost)', '| 1 | 12:56:40 | B3: --json flag, tests, README returned | 148k | 161k in · 3k out · 4 steps | a60ad8f accepted |', 'orchestrator totals: 0.79M tokens over 5 wakes · peak context 212k · 0 compactions']
    let at = 0
    for (const piece of order) { const i = md.indexOf(piece, at); expect(i >= 0 ? piece : `MISSING after ${at}: ${piece}`).toBe(piece); at = i }
  })
  test('zero children and a running mission render without throwing', async () => {
    const empty = projectLedger({ version: 1, startedAt: T(12, 51), now: T(12, 52), status: 'running', sessionId: 's1', orch: { ...orch, verifyRequests: [], integration: undefined, cursor: 0 }, kids: [], turns: [], compactions: 0 })
    expect(ledgerHeadline(empty, T(12, 52))[0]).toBe('0 children (0 builders · 0 verifiers · 0 integrators) · 0 redo · 0 rejected · checks 0/0 PASS · integration 0/0 PASS')
    const md = renderLedger(mergeLedger(undefined, empty, '/r', T(12, 52)), T(12, 52))
    expect(md).toContain('(no children yet)')
    expect(md).toContain('| current | 12:51 → now |')
    const live = ledgerLiveLine(empty, T(12, 52))
    expect(live.warn).toBe(false)
    expect(live.text).toContain('PROVED so far  0 returned · checks 0/0')
  })
  test('the live line goes yellow when the stage so far has a return but no registered check', async () => {
    const noCheck = [agent({ id: 'b1b1b1b1b1b1b1b1b', type: 'orc:builder', description: 'B1: cards', startedAt: T(12, 52), endedAt: T(12, 55), toolCalls: 9 }), agent({ id: 'b2b2b2b2b2b2b2b2b', type: 'orc:builder', description: 'B2: more cards', startedAt: T(12, 53), status: 'running' })]
    const running = projectLedger({ version: 1, startedAt: T(12, 51), now: T(12, 56), status: 'running', sessionId: 's1', orch: { ...orch, verifyRequests: [], integration: undefined }, kids: noCheck, turns: [], compactions: 0 })
    expect(ledgerLiveLine(running, T(12, 56))).toEqual({ warn: true, text: NO_CHECK_LINE })
    const checked = projectLedger({ version: 1, startedAt: T(12, 51), now: T(12, 56), status: 'running', sessionId: 's1', orch: { ...orch, verifyRequests: [], integration: undefined }, kids: [{ ...noCheck[0]!, checkResult: pass('OK') }, noCheck[1]!], turns: [], compactions: 0 })
    expect(ledgerLiveLine(checked, T(12, 56)).warn).toBe(false)
    expect(ledgerLiveLine(checked, T(12, 56)).text).toContain('1 returned · checks 1/1')
  })
  test('a resumed session never overwrites a measured number with zero; its own cost adds a session', async () => {
    const first = mergeLedger(undefined, src({ status: 'running' }), '/r', T(13, 2))
    const adopted = kids.map(k => ({ ...k, toolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, checkResult: undefined, verifierCounts: undefined }))
    const resumed = projectLedger({ version: 2, startedAt: T(12, 51), now: NOW, status: 'done', finalStatus: 'STATUS: PASS', sessionId: 's2', orch: { ...orch, inputTokens: 0, outputTokens: 1000, cacheReadTokens: 50000, cacheWriteTokens: 0, ctxMax: 90000 }, kids: adopted, turns: [turn({ turnId: 't6', startedAt: T(13, 2, 55), wake: 'resumed', contextTokens: 90000 })], compactions: 1 })
    const l = mergeLedger(first, resumed, '/r', NOW)
    const v = l.versions[0]!
    expect(v.children['a60ad8fdd0848c158']!.tokens).toBe(412127)
    expect(v.children['a60ad8fdd0848c158']!.check?.evidence).toContain('Ran 16 tests')
    expect(v.verifications['vr-checkpoint-1']!.counts?.pass).toBe(6)
    expect(Object.keys(v.wakes).length).toBe(6)
    expect(Object.keys(v.orchestrator)).toEqual(['s1', 's2'])
    expect(v.compactions).toBe(1)
    expect(v.status).toBe('done')
    expect(ledgerHeadline(v, NOW)[2]).toContain('6 wakes · peak context 212k · 1 compaction')
  })
  test('a new version adds a section; an older one stays as it was', async () => {
    const l = mergeLedger(mergeLedger(undefined, src(), '/r', NOW), src({ version: 3, startedAt: T(13, 10), now: T(13, 12), status: 'running', kids: [], turns: [], orch: { ...orch, verifyRequests: [], integration: undefined, cursor: 0 } }), '/r', T(13, 12))
    expect(l.versions.map(v => v.version)).toEqual([2, 3])
    const md = renderLedger(l, T(13, 12))
    expect(md.indexOf('· v3 · ')).toBeLessThan(md.indexOf('· v2 · '))
    expect(md).toContain('---')
  })
  test('the four lines the owner reads at done, and the toast\'s first two', async () => {
    const lines = ledgerDoneLines(src(), NOW, { status: 'STATUS: PASS (final verification passed at commit b0ee8e9)', reading: 'the --json flag shipped as specified; a nan/inf traceback my spot-check found was fixed (B4) before final verification.' })
    expect(lines.length).toBe(4)
    expect(lines[0]).toBe('mission v2 DONE · PASS at b0ee8e9 · 12m00')
    expect(lines[1]).toBe('PROVED  5 children · checks 3/3 · verifiers 6/6, 10/10 · 0 redo · 1.93M (orchestrator 41%) · peak context 212k')
    expect(lines[2]).toContain('READ    "the --json flag shipped as specified')
    expect(lines[3]).toBe('ledger  ops/orc/LEDGER.md · report ops/FINAL.md')
    expect(doneSection({ repo: '/r', version: 2, outcome: { lines } })).toContain(lines[1]!)
  })
  test('the stamped PROVED line is the ledger headline of the same version, verbatim', async () => {
    const v = src()
    const head = ledgerHeadline(v, NOW)
    const { text } = stampReport(FINAL_OK, head, NOW)
    expect(text).toContain(`PROVED (ledger): ${head.join(' · ')}`)
    expect(renderLedger(mergeLedger(undefined, v, '/r', NOW), NOW)).toContain(head.join('\n'))
  })
})

describe('the intake is in the ledger (WO-0220b, done-means 5)', () => {
  // The proof run's shape: 12 requests and 665,147 tokens between /orc begin (12:40:00) and the launch (12:46:10).
  const BEGAN = T(12, 40), LAUNCH = T(12, 46, 10)
  const intakeTurns: OrcTurn[] = [
    turn({ turnId: 'i0', startedAt: T(12, 38), endedAt: T(12, 39), wake: '', steps: 9, inTokens: 999999, outputTokens: 999 }),
    turn({ turnId: 'i1', startedAt: T(12, 40, 5), endedAt: T(12, 41), wake: '', steps: 5, inTokens: 300000, outputTokens: 2000 }),
    turn({ turnId: 'i2', startedAt: T(12, 43), endedAt: T(12, 45, 50), wake: '', steps: 7, inTokens: 360147, outputTokens: 3000 }),
    turn({ turnId: 'i3', startedAt: T(12, 46, 5), endedAt: T(12, 47), wake: '', steps: 2, inTokens: 500000, outputTokens: 100 }),
  ]
  test('the intake counts the closed turns between begin and launch: requests, tokens, minutes', async () => {
    expect(intakeOf(intakeTurns, BEGAN, LAUNCH)).toEqual({ requests: 12, tokens: 665147, ms: 370000 })
    expect(intakeOf([], BEGAN, LAUNCH)).toEqual({ requests: 0, tokens: 0, ms: 370000 })
  })
  test('the headline total and the orchestrator share include it, and say so', async () => {
    const v = src({ intake: { requests: 12, tokens: 665147, ms: 370000 } })
    const [, l2] = ledgerHeadline(v, NOW)
    expect(l2).toContain('2.60M tokens (orchestrator 1.45M = 56%, of which intake 0.67M)')
    expect(ledgerDoneLines(v, NOW, { status: 'STATUS: PASS' })[1]).toContain('2.60M (orchestrator 56%)')
    expect(ledgerLiveLine({ ...v, status: 'running', endedAt: undefined }, NOW).text).toContain('2.60M')
    const md = renderLedger(mergeLedger(undefined, v, '/r', NOW), NOW)
    expect(md).toContain('orchestrator totals: 1.45M tokens over 5 wakes')
    expect(md.indexOf('intake: 12 requests · 0.67M · 6m10 (before approval)')).toBeGreaterThan(md.indexOf('orchestrator totals:'))
  })
  test('without a recorded intake the ledger says so and the share stands alone', async () => {
    const v = src()
    expect(ledgerHeadline(v, NOW)[1]).toContain('1.93M tokens (orchestrator 0.79M = 41%)')
    expect(ledgerHeadline(v, NOW)[1]).not.toContain('intake')
    expect(renderLedger(mergeLedger(undefined, v, '/r', NOW), NOW)).toContain('intake: not recorded in this session')
    expect(intakeLine(undefined)).toBe('intake: not recorded in this session')
  })
  test('a resumed session never drops the intake the launching session recorded', async () => {
    const first = mergeLedger(undefined, src({ status: 'running', intake: { requests: 12, tokens: 665147, ms: 370000 } }), '/r', T(13, 2))
    const l = mergeLedger(first, src({ status: 'done', sessionId: 's2' }), '/r', NOW)
    expect(l.versions[0]!.intake).toEqual({ requests: 12, tokens: 665147, ms: 370000 })
  })
})

// ---- WO-0220c: proof 2's recorded shape (~/orc-examples/pkgtest3, 2026-10-09 21:11–21:22Z): ops/orc/ledger.json, the
// session's turns and agents. n2 returned twice: check FAIL → mark redo → steer → check PASS → mark accepted. The closing
// turn (5bfd9bec, 4 requests, 627,797 tokens) was still open when the tick settled the mission.
describe('attempt history and settle timing (WO-0220c, proof 2)', () => {
  const S0 = 1791580285059, SETTLE = 1791580958440
  const fail = (ms: number, tail: string, reason?: string) => ({ status: 'fail' as const, exitCode: 1, ms, outputTail: tail, ...(reason ? { reason } : {}) })
  const clean = { outside: [], othersRunning: [], checkedAt: 0 }
  const wt = (sha: string) => ({ path: '/p-wt/x', branch: 'wt/x', base: '/p', merged: 'merged' as const, mergeSha: sha })
  const n2Fail = { at: 1791580496000, ...fail(1100, 'Ran 8 tests in 1.042s\n\nOK\nFAIL: literal yd error string missing in tests/test_convert.py') }
  const n2Pass = { at: 1791580648268, ...pass('Ran 8 tests in 1.036s\n\nOK', 1172) }
  const n2Redo = { verdict: 'redo' as const, note: 'check FAIL: the literal yd error string is missing; steering the same child to add it', at: 1791580528000 }
  const n2Acc = { verdict: 'accepted' as const, note: 'Substrate: ops/checks/n2.sh PASS in the clone (8 tests OK plus all literal greps), boundary clean. Accepted after one redo for the literal string.', at: 1791580656516 }
  const p2kids: OrcAgent[] = [
    agent({ id: 'a8d3a782fe6782eec', type: 'orc:builder', description: 'n1: implement length converter', startedAt: 1791580384312, endedAt: 1791580401351, toolCalls: 4, cacheReadTokens: 38368, checkResult: fail(370, '/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/x'), boundaryReport: clean, worktree: wt('13b7c1b'), mark: { verdict: 'accepted', note: 'Registered check FAIL was caused by my check script cd-ing into the main repo', at: 1791580446840 } }),
    agent({ id: 'a201181d88172e0a9', type: 'orc:integrator', description: 'auto integrator: first merge (n1: implement length c… [for main]', startedAt: 1791580468660, endedAt: 1791580617767, toolCalls: 10, cacheReadTokens: 217547, checkResult: pass('PASS 9 standard library only\nINTEGRATION: PASS', 5400), boundaryReport: clean, mark: { verdict: 'accepted', note: 'Substrate ran ops/integration/check.sh at HEAD: INTEGRATION PASS', at: 1791580631423 } }),
    agent({ id: 'a6a903207a6982cda', type: 'orc:builder', description: 'n3: README for converter', startedAt: 1791580480900, endedAt: 1791580510192, toolCalls: 9, cacheReadTokens: 83337, checkResult: fail(102, 'ValueError: stdout and stderr arguments may not be used with capture_output.'), boundaryReport: clean, worktree: wt('474a1a3'), mark: { verdict: 'accepted', note: 'Registered check crashed on a bug in my own ops/checks/n3.sh', at: 1791580556321 } }),
    agent({ id: 'a474fc3e1af67996c', type: 'orc:builder', description: 'n2: unittest suite for converter', startedAt: 1791580480900, endedAt: 1791580648268, toolCalls: 6, cacheReadTokens: 55263, runs: 2, checkResult: pass('Ran 8 tests in 1.036s\n\nOK', 1172), checks: [n2Fail, n2Pass], boundaryReport: clean, worktree: wt('85bdbde'), mark: n2Acc, marks: [n2Redo, n2Acc] }),
    agent({ id: 'ae33dd72e40e06ea0', type: 'orc:verifier', description: 'auto verifier: checkpoint [for main]', startedAt: 1791580686795, endedAt: 1791580756546, toolCalls: 12, cacheReadTokens: 133704, verifierCounts: { verdict: 'PASS', pass: 10, fail: 0, na: 1, defects: 0 }, mark: { verdict: 'accepted', note: 'Checkpoint verifier PASS on snapshot 07c5563', at: 1791580761806 } }),
    agent({ id: 'a494ae48ae8164fc3', type: 'orc:verifier', description: 'auto verifier: final [for main]', startedAt: 1791580814207, endedAt: 1791580931733, toolCalls: 10, cacheReadTokens: 152923, verifierCounts: { verdict: 'PASS', pass: 15, fail: 0, na: 0, defects: 1 }, mark: { verdict: 'accepted', note: 'Final verifier PASS on snapshot 89eb0a4', at: 1791580937004 } }),
  ]
  // The orchestrator's row as the tick found it at the settle (5,824,851 tokens; the closing turn not yet added).
  const p2orch = agent({ id: 'main', type: 'orc:orchestrator', description: 'orchestrator (main session)', startedAt: S0, status: 'running', parentId: undefined, cursor: 7, inputTokens: 1108, outputTokens: 26968, cacheReadTokens: 5669294, cacheWriteTokens: 127481, ctxMax: 156746,
    verifyRequests: [{ id: 'vr-checkpoint-1791580671741', stage: 'checkpoint', at: 1791580671741, repo: '/p', snapshot: '/p-wt/verify-checkpoint-07c5563-k1' }, { id: 'vr-final-1791580798604', stage: 'final', at: 1791580798604, repo: '/p', snapshot: '/p-wt/verify-final-89eb0a4-k2' }],
    integration: { repo: '/p', runs: [{ at: 1791580597896, after: 'n3: README for converter', status: 'pass', exitCode: 0, ms: 5265, tail: 'INTEGRATION: PASS', reported: true, load: 3.9, cores: 8 }, { at: 1791580657967, after: 'n2: unittest suite for converter', status: 'pass', exitCode: 0, ms: 6369, tail: 'INTEGRATION: PASS', reported: true, load: 3.1, cores: 8 }], dispatches: [] } })
  const p2turns: OrcTurn[] = [
    turn({ turnId: '774c3d35', startedAt: 1791580287591, endedAt: 1791580387251, wake: 'notice (+1 more)', contextTokens: 103624, inTokens: 557846, outputTokens: 8633, steps: 6 }),
    turn({ turnId: '420d00df', startedAt: 1791580415237, endedAt: 1791580483282, wake: 'n1: implement length converter returned', contextTokens: 116165, inTokens: 1000403, outputTokens: 4768, steps: 9 }),
    turn({ turnId: '606ea9db', startedAt: 1791580497965, endedAt: 1791580560730, wake: 'n2: unittest suite for converter returned', contextTokens: 126754, inTokens: 985369, outputTokens: 4080, steps: 8 }),
    turn({ turnId: 'ad5d9611', startedAt: 1791580625934, endedAt: 1791580642369, wake: 'integrator returned', contextTokens: 132435, inTokens: 527211, outputTokens: 974, steps: 4 }),
    turn({ turnId: '12a7a891', startedAt: 1791580650090, endedAt: 1791580691848, wake: 'n2: unittest suite for converter returned', contextTokens: 140215, inTokens: 958546, outputTokens: 3183, steps: 7 }),
    turn({ turnId: '28aeaa05', startedAt: 1791580758533, endedAt: 1791580816632, wake: 'checkpoint verifier returned', contextTokens: 150806, inTokens: 884922, outputTokens: 4329, steps: 6 }),
  ]
  // The closing turn: open at the tick (3 requests seen), then its 4th request and its turn.complete usage.
  const openTurn = turn({ turnId: '5bfd9bec', startedAt: 1791580933772, wake: 'final verifier returned', contextTokens: 156746, outputTokens: 1519, steps: 3 })
  const usage = { input_tokens: 4, output_tokens: 1866, cache_read_input_tokens: 600000, cache_creation_input_tokens: 25927 }
  const STATUS = 'STATUS: DONE — final verification PASSED (criteria 1–11, snapshot 89eb0a4)'
  const intake = { requests: 15, tokens: 892879, ms: 498244 }
  const p2 = (o: Partial<Parameters<typeof projectLedger>[0]> = {}) => projectLedger({ version: 1, startedAt: S0, now: SETTLE, status: 'done', finalStatus: STATUS, sessionId: 'bafd9002', orch: p2orch, kids: p2kids, turns: p2turns, compactions: 0, intake, ...o })
  // After the fix: the turn closes (usage on the row, the turn in the list), then the settle.
  const closedOrch = { ...withTurnUsage(p2orch, usage), ctxMax: 158059 }
  const closing = closedTurn({ ...openTurn, contextTokens: 158059, outputTokens: 1866, steps: 4 }, usage, 1791580958400, 'answer', 'FINAL is DONE')
  const settled = () => p2({ orch: closedOrch, turns: [...p2turns, closing] })

  test('the headline counts every check run and every redo mark: checks 2/5, 1 redo (proof 2 said 2/4 and 0)', async () => {
    const [l1] = ledgerHeadline(settled(), SETTLE)
    expect(l1).toBe('6 children (3 builders · 2 verifiers · 1 integrator) · 1 redo · 0 rejected · checks 2/5 PASS · integration 2/2 PASS')
    const t = ledgerTotals(settled(), SETTLE)
    expect([t.checksPass, t.checksTotal, t.redo, t.returned, t.attempts]).toEqual([2, 5, 1, 6, 7])
  })
  test('the child row shows both runs and both marks, and its attempts', async () => {
    const v = settled()
    const n2 = v.children['a474fc3e1af67996c']!
    expect(n2.attempts).toBe(2)
    expect(n2.checks!.map(c => c.status)).toEqual(['fail', 'pass'])
    expect(n2.marks!.map(m => m.verdict)).toEqual(['redo', 'accepted'])
    expect(n2.check).toEqual({ status: 'pass', ms: 1172, evidence: 'Ran 8 tests in 1.036s · OK' })
    expect(n2.mark?.verdict).toBe('accepted')
    expect(checkCell(n2)).toBe('FAIL 1s → PASS 1s (2 runs) · "Ran 8 tests in 1.036s · OK"')
    expect(markCell(n2)).toContain('redo → accepted: "Substrate: ops/checks/n2.sh PASS')
    const md = renderLedger(mergeLedger(undefined, v, '/Users/emeka/orc-examples/pkgtest3', SETTLE), SETTLE)
    expect(md).toContain('| a474fc3 | builder | n2: unittest suite for converter | 2m47 | 2 | 6 | 55k | FAIL 1s → PASS 1s (2 runs) · "Ran 8 tests in 1.036s · OK" | clean | merged 85bdbde | redo → accepted: "Substrate: ops/checks/n2.sh PASS')
    // one run, one mark: the cells read as before
    expect(md).toContain('| a6a9032 | builder | n3: README for converter | 29s | 1 | 9 | 83k | FAIL 0s · "ValueError: stdout and stderr arguments may not be used wit…" | clean | merged 474a1a3 | accepted: "Registered check crashed')
  })
  test('the stage table and the live line use the same counts; the wake that made the redo lists it', async () => {
    const v = settled()
    const st = ledgerStages(v, SETTLE)
    expect(st[0]!.name).toBe('to checkpoint 1')
    expect([st[0]!.checks, st[0]!.redo]).toEqual([{ pass: 2, total: 5 }, 1])
    const md = renderLedger(mergeLedger(undefined, v, '/p', SETTLE), SETTLE)
    expect(md).toContain('| to checkpoint 1 | 21:11 → 21:17 | n1, integrator, n3, n2 | 0.53M | 6 | 2/5 | 1 |')
    expect(md).toContain('| 3 | 21:14:57 | n2: unittest suite for converter returned | 127k | 0.99M in · 4k out · 8 steps | a474fc3 redo, a6a9032 accepted |')
    const live = ledgerLiveLine({ ...v, status: 'running', endedAt: undefined }, SETTLE)
    expect(live.text).toContain('PROVED so far  6 returned (7 attempts) · checks 2/5 · 1 redo · ')
  })
  test('histories merge by time: a union that never shrinks, and an old single record is not counted twice', async () => {
    const first = mergeLedger(undefined, settled(), '/p', SETTLE)
    // A resumed session adopts n2 from the snapshot: no check, its latest mark only (same instant, shortened note).
    const adopted = p2kids.map(k => ({ ...k, toolCalls: 0, cacheReadTokens: 0, runs: 1, checkResult: undefined, checks: undefined, marks: undefined, verifierCounts: undefined, mark: k.mark ? { ...k.mark, note: k.mark.note.slice(0, 40) + '…' } : undefined }))
    const l = mergeLedger(first, p2({ sessionId: 's2', kids: adopted, turns: [] }), '/p', SETTLE)
    const n2 = l.versions[0]!.children['a474fc3e1af67996c']!
    expect([n2.checks?.length, n2.marks?.length, n2.attempts]).toEqual([2, 2, 2])
    expect(n2.mark?.note).toBe(n2Acc.note)
    expect(ledgerHeadline(l.versions[0]!, SETTLE)[0]).toContain('1 redo · 0 rejected · checks 2/5 PASS')
    // A projection that lost the first run (only the latest) keeps it from the accumulator.
    const lost = mergeLedger(first, p2({ kids: p2kids.map(k => (k.id.startsWith('a474fc3') ? { ...k, checks: [n2Pass], marks: [n2Acc] } : k)) }), '/p', SETTLE)
    expect(lost.versions[0]!.children['a474fc3e1af67996c']!.checks!.map(c => c.status)).toEqual(['fail', 'pass'])
    // A ledger written before histories (check + mark only) merged with the same single record: still one run.
    const legacy = mergeLedger(undefined, p2(), '/p', SETTLE)
    const n3old = legacy.versions[0]!.children['a6a903207a6982cda']!
    legacy.versions[0]!.children['a6a903207a6982cda'] = { ...n3old, checks: undefined, marks: undefined, attempts: undefined }
    const again = mergeLedger(legacy, p2(), '/p', SETTLE).versions[0]!.children['a6a903207a6982cda']!
    expect([again.checks?.length, again.marks?.length, again.attempts]).toEqual([1, 1, 1])
  })
  test('settle waits for the closing turn; its ledger then includes that turn (proof 2 lost 627,797 tokens)', async () => {
    // At the tick (21:22:38) the closing turn is open: no settle.
    expect(settleBlock({ status: STATUS, liveChildren: 0, turnOpen: true })).toContain('turn is open')
    // What proof 2 wrote by settling then: the orchestrator 6.72M, the closing wake at 0 in.
    const before = p2({ turns: [...p2turns, openTurn] })
    expect(ledgerHeadline(before, SETTLE)[1]).toContain('7.40M tokens (orchestrator 6.72M = 91%, of which intake 0.89M)')
    // The turn completes: its usage on the row, the turn closed; now the settle may run.
    expect(settleBlock({ status: STATUS, liveChildren: 0, turnOpen: false })).toBeUndefined()
    const v = settled()
    const t = ledgerTotals(v, SETTLE)
    expect(t.orchTokens - ledgerTotals(before, SETTLE).orchTokens).toBe(627797)
    expect(t.orchTokens).toBe(7345527)
    const [l1, l2, l3] = ledgerHeadline(v, SETTLE)
    expect(l1).toContain('checks 2/5 PASS')
    expect(l2).toBe('verifiers: checkpoint PASS 10/10 · final PASS 15/15 · merges 3/3 · 8.03M tokens (orchestrator 7.35M = 92%, of which intake 0.89M)')
    expect(l3).toBe('11m13 · 7 wakes · peak context 158k · 0 compactions')
    expect(renderLedger(mergeLedger(undefined, v, '/p', SETTLE), SETTLE)).toContain('| 7 | 21:22:13 | final verifier returned | 158k | 0.63M in · 2k out · 4 steps | a494ae4 accepted |')
    // the other reasons not to settle
    expect(settleBlock({ status: undefined, liveChildren: 0, turnOpen: false })).toContain('no STATUS')
    expect(settleBlock({ status: 'STATUS: PENDING', liveChildren: 0, turnOpen: false })).toContain('PENDING')
    expect(settleBlock({ status: STATUS, liveChildren: 1, turnOpen: false })).toContain('1 child is still running')
  })
  test('the done line: the final verifier\'s verdict and commit, never "DONE · DONE"', async () => {
    const v = settled()
    const lines = ledgerDoneLines(v, SETTLE, { status: STATUS, reading: 'The length converter, its unittest suite and its README are built, merged and verified' })
    expect(lines[0]).toBe('mission v1 DONE · PASS at 89eb0a4 · 11m13')
    expect(lines[1]).toBe('PROVED  6 children · checks 2/5 · verifiers 10/10, 15/15 · 1 redo · 8.03M (orchestrator 92%) · peak context 158k')
    // a FAIL verdict wins over the STATUS text; a report without a VERDICT line, or no final verification, falls back to it
    const withFinal = (counts: Parameters<typeof doneVerdict>[0]['verifications'][string]['counts']) => ({ ...v, verifications: { ...v.verifications, 'vr-final-1791580798604': { ...v.verifications['vr-final-1791580798604']!, counts } } })
    expect(doneVerdict(withFinal({ verdict: 'FAIL', pass: 14, fail: 1, na: 0, defects: 1 }), 'STATUS: PASS')).toEqual({ word: 'FAIL', sha: '89eb0a4' })
    expect(doneVerdict(withFinal({ verdict: 'none', pass: 0, fail: 0, na: 0, defects: 0 }), STATUS)).toEqual({ word: 'PASS', sha: '89eb0a4' })
    const noFinal = { ...v, verifications: {} }
    expect(ledgerDoneLines(noFinal, SETTLE, { status: STATUS })[0]).toBe('mission v1 DONE · PASS at 89eb0a4 · 11m13')
    expect(ledgerDoneLines(noFinal, SETTLE, { status: 'STATUS: DONE' })[0]).toBe('mission v1 DONE · 11m13')
    expect(ledgerDoneLines(noFinal, SETTLE, { status: 'STATUS: DONE — shipped the converter' })[0]).toBe('mission v1 DONE · shipped the converter · 11m13')
  })
  test('the live line shows the last known context at a wake\'s first step, not "ctx 0"', async () => {
    const firstStep = p2({ status: 'running', now: 1791580934000, turns: [...p2turns, { ...openTurn, contextTokens: 0, outputTokens: 0, steps: 0 }] })
    const live = ledgerLiveLine(firstStep, 1791580934000)
    expect(live.text).toContain('ctx 151k · 7 wakes')
    expect(live.text).not.toContain('ctx 0')
  })
  test('/orc says "pane open." without an "orc: " of its own (the engine leads with the plugin\'s name)', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true as const } }))
    const r = await $.command.run({ command: 'orc', args: '' })
    expect(r.text).toBe('pane open.')
  })
})
