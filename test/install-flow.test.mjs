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
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ws = join(here, '..')
const tmpHome = join(ws, '.test-tmp', 'dsh')
const profileDir = join(tmpHome, 'profiles', 'web')

function fmtBytes(n) {
  n = Number(n) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function setupProfile() {
  rmSync(join(ws, '.test-tmp'), { recursive: true, force: true })
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
  const dir = join(ws, '.test-tmp', 'fixture-plugin')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-fixture-plugin',
    version: '1.0.0',
    main: 'lib/index.js',
    dsh: { client: { platform: 'web' } },
  }, null, 2))
  writeFileSync(join(dir, 'lib', 'index.js'), 'module.exports = { apply() {} }\n')
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
  // Let it start, then cancel quickly.
  await new Promise((r) => setTimeout(r, 1500))
  const canc = await _market.cancelJob(job)
  const result = await job.result
  console.log('=== CANCEL ===')
  console.log('cancel:', JSON.stringify(canc))
  console.log('final:', JSON.stringify({ ok: result.ok, phase: result.phase, error: result.error }))
  const ok = result.ok === false && result.phase === 'canceled'
  console.log(ok ? 'PASS cancel' : 'FAIL cancel')
  process.exit(ok ? 0 : 1)
}

console.log('unknown mode:', mode)
process.exit(2)
