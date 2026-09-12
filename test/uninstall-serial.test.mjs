/**
 * Regression test: SEVERAL SIMULTANEOUS uninstalls must all take effect, and
 * each one must run on the shared profile-write FIFO.
 *
 * The reported bug: clicking 卸载 on multiple installed plugins at the same
 * moment left only ONE of them removed. `POST /api/market/uninstall` used to
 * run `dsh plugin remove` straight from the request handler, so two concurrent
 * children read the profile's `package.json` before either wrote it back and
 * the last writer restored the other plugin's dependency. The host now queues
 * every profile mutation through `onProfileWrite` (one FIFO), which this test
 * asserts both behaviorally (all plugins gone) and structurally (an uninstall
 * issued while the queue is busy only starts after that task finishes).
 *
 * Runs against a THROWAWAY profile under the OS temp dir (never ~/.dsh).
 * Usage: node test/uninstall-serial.test.mjs
 */
import { _market } from '../lib/index.js'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// SPACE-FREE base: `dsh plugin add` mangles local paths containing spaces.
const tmpBase = join(os.tmpdir(), 'dsh-mkt-uninstall-' + process.pid)
const tmpHome = join(tmpBase, 'dsh')
const profileDir = join(tmpHome, 'profiles', 'web')
const NAMES = ['test-fixture-a', 'test-fixture-b', 'test-fixture-c']

process.env.DSH_HOME = tmpHome

function setupProfile() {
  rmSync(tmpBase, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web-test',
    private: true,
    dsh: { profile: { bundles: [] } },
    dependencies: {},
  }, null, 2))
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
}

/** One minimal local plugin fixture (installs offline in well under a second). */
function makeFixture(name) {
  const dir = join(tmpBase, 'fixture-' + name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default { inject: [], apply() {} }\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), '')
  return dir
}

function profileJson() {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
}

function fail(msg) {
  console.log('FAIL ' + msg)
  process.exit(1)
}

setupProfile()

// ── 1) install three local fixtures, one after another ───────────────────
for (const name of NAMES) {
  const dir = makeFixture(name)
  const started = _market.startInstall(dir)
  if (started.error) fail(`startInstall ${name}: ${started.error}`)
  const r = await started.job.result
  if (!r.ok) fail(`install ${name} did not succeed: ${r.error || r.phase}`)
  console.log('installed:', name, '|', r.phase)
}

{
  const deps = profileJson().dependencies || {}
  const missing = NAMES.filter((n) => !(n in deps))
  if (missing.length) fail('fixtures not in the profile: ' + missing.join(', '))
  console.log('profile deps before uninstall:', Object.keys(deps).join(', '))
}

// ── 2) block the profile-write FIFO, then uninstall all three at once ────
// A queued uninstall must NOT start while this task holds the queue, which is
// what proves uninstalls share the single write FIFO instead of racing.
const BLOCK_MS = 3000
let blockerEnd = 0
let blockerRan = false
const blocker = _market.onProfileWrite(async () => {
  blockerRan = true
  await new Promise((r) => setTimeout(r, BLOCK_MS))
  blockerEnd = Date.now()
})

const settledAfterBlocker = {}
const results = await Promise.all(NAMES.map((name) => {
  const startedAt = Date.now()
  return _market.uninstallPlugin(name).then((r) => {
    settledAfterBlocker[name] = Date.now() - startedAt
    return r
  })
}))

if (!blockerRan) fail('the blocking task never ran')
console.log('blocker held the queue for', BLOCK_MS, 'ms; uninstall wall times:', JSON.stringify(settledAfterBlocker))
if (blockerEnd === 0) fail('blocker did not finish')
for (const name of NAMES) {
  // Each uninstall was issued while the queue was busy, so it can only have
  // run after the blocker released the FIFO.
  if (!(settledAfterBlocker[name] >= BLOCK_MS)) {
    fail(`${name} uninstall ran before the profile-write queue was free (${settledAfterBlocker[name]}ms < ${BLOCK_MS}ms) — it is not serialized`)
  }
}
for (let i = 0; i < NAMES.length; i++) {
  const name = NAMES[i]
  const r = results[i]
  console.log('uninstall result:', name, JSON.stringify({ ok: r.ok, changed: r.changed, error: r.error, output: (r.output || '').slice(-200) }))
  if (!r.ok) fail(`${name} uninstall failed: ${r.error || r.output}`)
}

// ── 3) every one of them must be gone from the profile ───────────────────
{
  const manifest = profileJson()
  const deps = manifest.dependencies || {}
  const bundles = (manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || []
  const stillDeps = NAMES.filter((n) => n in deps)
  const stillBundles = NAMES.filter((n) => bundles.includes(n))
  const stillOnDisk = NAMES.filter((n) => existsSync(join(profileDir, 'node_modules', n, 'package.json')))
  console.log('profile deps after uninstall:', Object.keys(deps).join(', ') || '(none)')
  console.log('still in deps:', stillDeps.join(', ') || '(none)', '| still in bundles:', stillBundles.join(', ') || '(none)', '| still on disk:', stillOnDisk.join(', ') || '(none)')
  if (stillDeps.length) fail('concurrent uninstall left dependencies behind: ' + stillDeps.join(', '))
  if (stillBundles.length) fail('concurrent uninstall left bundle entries behind: ' + stillBundles.join(', '))
  if (stillOnDisk.length) fail('concurrent uninstall left packages on disk: ' + stillOnDisk.join(', '))
}

// ── 4) removing an already-removed plugin stays idempotent ───────────────
{
  const again = await _market.uninstallPlugin(NAMES[0])
  console.log('repeat uninstall of a removed plugin:', JSON.stringify(again))
  if (!again.ok || again.changed !== false) fail('repeat uninstall of a removed plugin should be a clean no-op')
}

// ── 5) a built-in (in the bundle layer, not a dependency) is still refused ─
// The built-in / already-gone distinction is made INSIDE the queue, so guard it
// explicitly: moving that check must not turn "内置插件" into a silent no-op.
{
  const manifest = profileJson()
  manifest.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base'] } }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
  const builtin = await _market.uninstallPlugin('@deepseek-ai/dsh-base')
  console.log('builtin uninstall refusal:', JSON.stringify({ ok: builtin.ok, changed: builtin.changed, error: builtin.error }))
  if (builtin.ok || builtin.changed) fail('a built-in plugin must not be removable')
  if (!/内置插件/.test(String(builtin.error || ''))) fail('built-in refusal must explain 内置插件不能卸载, got: ' + builtin.error)
  const stillBundled = (profileJson().dsh.profile.bundles || []).includes('@deepseek-ai/dsh-base')
  if (!stillBundled) fail('the built-in was dropped from the bundle layer')
}

await blocker
console.log('PASS concurrent uninstall (all ' + NAMES.length + ' removed, serialized on one FIFO)')
process.exit(0)
