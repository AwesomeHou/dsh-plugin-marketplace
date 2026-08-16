/**
 * Standalone functional test for the async install/update machinery.
 *
 * Runs against a THROWAWAY profile under <workspace>/.test-tmp/dsh (never the
 * real ~/.dsh), so it is safe to run repeatedly. The pnpm store is shared, so
 * the network install reuses cached packages and completes quickly.
 *
 * Usage: node test/install-flow.test.mjs [local|github|cancel]
 */
import { _market } from '../lib/index.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ws = join(here, '..')
// Use a SPACE-FREE base under the OS temp dir: `dsh plugin add` mangles local
// paths containing spaces (cmd.exe argv), so a fixture under the workspace
// (which has a space in its name) would not link correctly.
const tmpBase = join(os.tmpdir(), 'dsh-mkt-test-' + process.pid)
const tmpHome = join(tmpBase, 'dsh')
const profileDir = join(tmpHome, 'profiles', 'web')

function fmtBytes(n) {
  n = Number(n) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function setupProfile() {
  rmSync(tmpBase, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web-test',
    private: true,
    dsh: { profile: { bundles: [] } },
    dependencies: {},
  }, null, 2))
  // `dsh plugin add -w` requires the profile to be a pnpm workspace root,
  // mirroring the real profile's pnpm-workspace.yaml.
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
}

function makeFixture() {
  const dir = join(tmpBase, 'fixture-plugin')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-fixture-plugin',
    version: '1.0.0',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default { inject: [], apply() {} }\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), '')
  return dir
}

process.env.DSH_HOME = tmpHome

const mode = process.argv[2] || 'local'

if (mode === 'local') {
  setupProfile()
  const dir = makeFixture()
  const started = _market.startInstall(dir)
  if (started.error) throw new Error('startInstall local error: ' + started.error)
  const job = started.job
  let last = null
  const timer = setInterval(() => { last = _market.snapshotOf(job) }, 150)
  const result = await job.result
  clearInterval(timer)
  console.log('=== LOCAL INSTALL ===')
  console.log('final:', JSON.stringify({ ok: result.ok, phase: result.phase, installed: result.installed, error: result.error, requiresRestart: result.requiresRestart }))
  console.log('last progress:', JSON.stringify(last))
  const ok = result.ok === true && result.phase === 'done' && !result.error
  console.log(ok ? 'PASS local install' : 'FAIL local install')
  process.exit(ok ? 0 : 1)
}

if (mode === 'github') {
  setupProfile()
  const started = _market.startInstall('Lum1104/dsh-browser')
  if (started.error) throw new Error('startInstall github error: ' + started.error)
  const job = started.job
  let last = null
  let ticks = 0
  const timer = setInterval(() => {
    last = _market.snapshotOf(job)
    ticks++
    const s = last
    const line = `[${s.phase}] pct=${s.percent} pkg=${s.packages.resolved}/${s.packages.downloaded}/${s.packages.added} bytes=${fmtBytes(s.bytesDown)}${s.bytesTotal ? '/' + fmtBytes(s.bytesTotal) : ''} speed=${Math.round((s.speedBps || 0) / 1024)}KB/s eta=${s.etaSec}s log=${s.log[s.log.length - 1] || ''}`
    console.log(line)
  }, 1000)
  const result = await job.result
  clearInterval(timer)
  console.log('=== GITHUB INSTALL (real network) ===')
  console.log('ticks:', ticks)
  console.log('final:', JSON.stringify({ ok: result.ok, phase: result.phase, installed: result.installed, error: result.error, requiresRestart: result.requiresRestart }))
  console.log('last progress:', JSON.stringify(last))
  const ok = result.ok === true && result.phase === 'done' && !result.error
  console.log(ok ? 'PASS github install' : 'FAIL github install')
  process.exit(ok ? 0 : 1)
}

if (mode === 'cancel') {
  setupProfile()
  const dir = makeFixture()
  const started = _market.startInstall(dir)
  const job = started.job
  // Cancel immediately while the job is still queued/running (the fixture
  // installs in <1s, so there is no window to cancel it after it starts).
  const canc = await _market.cancelJob(job)
  const result = await job.result
  console.log('=== CANCEL ===')
  console.log('cancel:', JSON.stringify(canc))
  console.log('final:', JSON.stringify({ ok: result.ok, phase: result.phase, error: result.error }))
  const ok = result.ok === false && result.phase === 'canceled'
  console.log(ok ? 'PASS cancel' : 'FAIL cancel')
  process.exit(ok ? 0 : 1)
}

if (mode === 'workspace-check') {
  // profileInstallError: without pnpm-workspace.yaml install must be refused
  // with a friendly message; with it, a job must start.
  rmSync(tmpBase, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-web-test', private: true, dsh: { profile: { bundles: [] } }, dependencies: {} }))
  const r1 = _market.startInstall('github:foo/bar')
  console.log('=== WORKSPACE CHECK ===')
  console.log('no pnpm-workspace.yaml → error:', r1.error)
  const ok1 = !!r1.error && /pnpm-workspace\.yaml/.test(r1.error)
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const r2 = _market.startInstall('github:foo/bar')
  console.log('with pnpm-workspace.yaml → job:', !!r2.job, '| error:', r2.error || null)
  const ok2 = !!r2.job && !r2.error
  if (r2.job) await _market.cancelJob(r2.job) // never actually install
  const ok = ok1 && ok2
  console.log(ok ? 'PASS workspace check' : 'FAIL workspace check')
  process.exit(ok ? 0 : 1)
}

if (mode === 'monorepo') {
  setupProfile()
  const started = _market.startInstall('Lum1104/dsh-browser')
  if (started.error) throw new Error('startInstall monorepo error: ' + started.error)
  const job = started.job
  let last = null
  let lastStep = null
  const timer = setInterval(() => {
    last = _market.snapshotOf(job)
    if (last.step !== lastStep) { lastStep = last.step; console.log('  step:', last.step, '| phase:', last.phase) }
  }, 1000)
  const result = await job.result
  clearInterval(timer)
  console.log('=== MONOREPO INSTALL (real dsh-browser) ===')
  console.log('final:', JSON.stringify({ ok: result.ok, phase: result.phase, installed: result.installed, error: result.error }))
  // verify final profile state
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles || []
  const depName = '@deepseek-ai/dsh-bridge-browser'
  const mainExists = existsSync(join(profileDir, 'node_modules', depName, 'lib', 'index.js'))
  console.log('in bundles:', bundles.includes(depName), '| main exists:', mainExists)
  const ok = result.ok === true && result.phase === 'done' && bundles.includes(depName) && mainExists
  console.log(ok ? 'PASS monorepo install' : 'FAIL monorepo install')
  process.exit(ok ? 0 : 1)
}

console.log('unknown mode:', mode)
process.exit(2)
