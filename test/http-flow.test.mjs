/**
 * HTTP-surface test: drive the marketplace plugin through a fake cordis ctx,
 * exercising the real `/api/market/install` → `/api/market/install/status`
 * → `/api/market/install/cancel` handler chain the browser uses.
 *
 * Uses a throwaway profile under <workspace>/.test-tmp and a local fixture
 * package (fast, offline-ish). Set DSH_HOME so the real profile is untouched.
 */
import plugin from '../lib/index.js'
import { _market } from '../lib/index.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ws = join(here, '..')
// SPACE-FREE base (see install-flow.test.mjs): local fixture paths must not
// contain spaces or `dsh plugin add` mangles them.
const tmpBase = join(os.tmpdir(), 'dsh-mkt-http-' + process.pid)
const tmpHome = join(tmpBase, 'dsh')
const profileDir = join(tmpHome, 'profiles', 'web')

rmSync(tmpBase, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-web-test', private: true, dsh: { profile: { bundles: [] } }, dependencies: {} }))
writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
const fix = join(tmpBase, 'fixture-plugin')
mkdirSync(join(fix, 'lib'), { recursive: true })
writeFileSync(join(fix, 'package.json'), JSON.stringify({ name: 'test-fixture-plugin', version: '1.0.0', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
writeFileSync(join(fix, 'lib', 'index.js'), 'export default { inject: [], apply() {} }')
writeFileSync(join(fix, 'cordis.patch.yml'), '')
process.env.DSH_HOME = tmpHome

// ── fake cordis ctx ──────────────────────────────────────────────────────
const routes = []
const tools = []
let effectRan = 0
const ctx = {
  webServer: { register: (r) => { routes.push(r) } },
  tools: { register: (t) => { tools.push(t) } },
  effect: (fn) => { effectRan++; fn() },
  interval: () => {},
  baseUrl: 'file://' + ws + '/',
}
plugin.apply(ctx)

function findRoute(path) { return routes.find((r) => r.path === path) }
function fakeRes() {
  const res = { status: 0, headers: null, body: '', writeHead(s, h) { this.status = s; this.headers = h }, end(b) { this.body = b } }
  return res
}
function fakePost(json) {
  const req = { method: 'POST' }
  req[Symbol.asyncIterator] = async function* () { yield JSON.stringify(json) }
  return req
}

console.log('registered routes:', routes.map((r) => r.path).join(', '))
console.log('registered tools:', tools.map((t) => t.name).join(', '))
if (effectRan !== routes.length + tools.length) throw new Error(`effect mismatch: ${effectRan} vs ${routes.length + tools.length}`)

const installRoute = findRoute('/api/market/install')
const statusRoute = findRoute('/api/market/install/status')
const cancelRoute = findRoute('/api/market/install/cancel')
if (!installRoute || !statusRoute || !cancelRoute) throw new Error('install/status/cancel routes missing')

// ── POST /api/market/install ─────────────────────────────────────────────
const res1 = fakeRes()
await installRoute.handler(fakePost({ spec: fix }), res1)
const startBody = JSON.parse(res1.body)
console.log('install start:', res1.status, JSON.stringify(startBody))
if (res1.status !== 202 || !startBody.ok || !startBody.jobId) throw new Error('install did not return 202 + jobId')
const jobId = startBody.jobId

// ── poll status until done (bounded) ─────────────────────────────────────
let last = null
let sawProgress = false
let sawPhase = new Set()
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 400))
  const res = fakeRes()
  await statusRoute.handler({ method: 'GET', url: '/api/market/install/status?job=' + encodeURIComponent(jobId) }, res)
  const body = JSON.parse(res.body)
  if (!body.ok) throw new Error('status not ok: ' + JSON.stringify(body))
  last = body.job
  if (last.percent !== null) sawProgress = true
  sawPhase.add(last.phase)
  if (last.done) break
}
console.log('seen phases:', [...sawPhase].join(' -> '), '| sawProgress:', sawProgress)
console.log('final status:', JSON.stringify({ phase: last.phase, percent: last.percent, ok: last.ok, packages: last.packages, bytesDown: last.bytesDown }))
if (!last.done || !last.ok || last.phase !== 'done' || last.percent !== 100) throw new Error('install did not finish ok')
if (!sawProgress) throw new Error('no progress percent observed')

// ── cancel a queued install ──────────────────────────────────────────────
// Start TWO installs back-to-back; the second is queued behind the first.
// Cancel the second immediately — since it is still queued, the executeJob
// cancel-guard must turn it into a clean 'canceled' (never run).
async function startJobViaHttp(spec) {
  const res = fakeRes()
  await installRoute.handler(fakePost({ spec }), res)
  const body = JSON.parse(res.body)
  if (body.status === 202 || body.ok) return body.jobId
  return body.jobId
}
async function statusJob(jobId) {
  const res = fakeRes()
  await statusRoute.handler({ method: 'GET', url: '/api/market/install/status?job=' + encodeURIComponent(jobId) }, res)
  return JSON.parse(res.body).job
}
const jobB = await startJobViaHttp(fix)
const jobC = await startJobViaHttp(fix)
const resC = fakeRes()
await cancelRoute.handler(fakePost({ jobId: jobC }), resC)
console.log('cancel response:', JSON.parse(resC.body))
let bDone = false, cCanceled = false
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 300))
  const b = await statusJob(jobB)
  const c = await statusJob(jobC)
  if (b.done && b.ok) bDone = true
  if (c.done && c.phase === 'canceled') cCanceled = true
  if (bDone && cCanceled) break
}
console.log('jobB done ok:', bDone, '| jobC canceled:', cCanceled)
if (!bDone) throw new Error('first queued install did not finish ok')
if (!cCanceled) throw new Error('second queued install was not canceled')

console.log('PASS http flow')
process.exit(0)
