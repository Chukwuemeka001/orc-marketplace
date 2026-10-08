// Smoke tests for what a stranger meets first. Run: claude plugin test <plugin-dir>
import { test, expect, describe } from 'claude-code/testing'
import { ownReadRoot } from '../hooks/policy'

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
