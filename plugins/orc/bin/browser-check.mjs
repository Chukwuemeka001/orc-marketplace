// orc computer: prove the configured browser server works before a mission starts (front-loading).
// Usage: node browser-check.mjs '<json: {"command": "...", "args": [...]}>'
// Serves a tiny page on 127.0.0.1, opens it through the browser server at 375 px, measures it, closes everything.
// Prints one JSON line: {"ok": true, "tools": N, "width": 375} or {"ok": false, "error": "..."}.
import { spawn } from 'node:child_process'
import http from 'node:http'
const cfg = JSON.parse(process.argv[2] ?? '{}')
// Plain-words reasons for the failures people actually hit.
const explain = (e) => /ENOENT/.test(e) && /npx|node/.test(e) ? `${e} (orc's browser needs Node.js 18 or later, which provides npx)`
  : /Executable doesn't exist|browserType\.launch|Failed to launch|chromium/i.test(e) ? `no browser to drive: install Google Chrome, or run "npx playwright install chromium" (about 150 MB). Detail: ${e.slice(0, 160)}`
  : e
const done = (o) => { if (o.error) o.error = explain(String(o.error)); console.log(JSON.stringify(o)); process.exit(0) }
const timer = setTimeout(() => done({ ok: false, error: 'timed out after 170 s (the first use downloads the browser tool; try again)' }), 170000)
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><meta name="viewport" content="width=device-width"><h1>orc browser check</h1>') })
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const p = spawn(cfg.command, cfg.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = '', id = 0; const waiting = new Map()
  p.on('error', e => done({ ok: false, error: `could not start ${cfg.command}: ${e.message}` }))
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; try { const m = JSON.parse(line); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } } catch {} } })
  const call = (method, params) => new Promise(r => { const n = ++id; waiting.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  const text = m => (m.result?.content ?? []).map(c => c.text).join(' ')
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'orc-browser-check', version: '1' } })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const tools = (await call('tools/list', {})).result?.tools?.length ?? 0
    const nav = await call('tools/call', { name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${port}/` } })
    if (nav.result?.isError || /Error/.test(text(nav))) throw new Error(`could not open a local page: ${text(nav).slice(0, 200)}`)
    await call('tools/call', { name: 'browser_resize', arguments: { width: 375, height: 812 } })
    const m = /"w":\s*(\d+)/.exec(text(await call('tools/call', { name: 'browser_evaluate', arguments: { function: '() => ({ w: innerWidth })' } })))
    await call('tools/call', { name: 'browser_close', arguments: {} })
    p.kill(); server.close(); clearTimeout(timer)
    done({ ok: true, tools, width: m ? Number(m[1]) : null })
  } catch (e) { p.kill(); server.close(); done({ ok: false, error: String(e.message ?? e) }) }
})
