/**
 * Upgrade validation:
 *  1) classifyPnpmFailure recognizes the borrowed pnpm failure modes.
 *  2) runtimeDepsReachable validates the real profile's dsh-better-sidebar.
 *  3) planInstall npm-preference for the 4 test plugins.
 *  4) install-test all 4 plugins on a THROWAWAY profile via _market.startInstall.
 */
import { _market } from './lib/index.js'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

let allPass = true
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) allPass = false }

// ── 1) classifyPnpmFailure ──
console.log('\n=== 1) classifyPnpmFailure ===')
const samples = [
  ['ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF This modules directory was created using a different virtual-store-dir-max-length value', 'hoist-pattern-diff'],
  ['ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF modules dir was built by a different pnpm major', 'hoist-pattern-diff'],
  ['ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @deepseek-ai/dsh-llm@>=0.1.0 <0.2.0', 'peer-resolution'],
  ['ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: node-pty, koffi.', 'ignored-builds'],
  ['ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  The git-hosted package "dsh-better-sidebar@2.8.0" needs to execute build scripts', 'git-prepare-not-allowed'],
  ['ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/ghost-pkg: Not Found - 404', 'fetch-404'],
  ['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION  package "x@1.0.0" is only 3 hours old', 'release-age'],
  ['--workspace-root may only be used inside a workspace', 'not-a-workspace'],
  ['pnpm not found on PATH', 'pnpm-missing'],
  ['some totally unrelated output', null],
]
for (const [out, expected] of samples) {
  const got = _market.classifyPnpmFailure(out)
  check((got ? got.code : null) === expected, `classify "${out.slice(0, 45)}..." -> ${got ? got.code : null} (exp ${expected})`)
}

// ── 2) runtimeDepsReachable on real profile ──
console.log('\n=== 2) runtimeDepsReachable (real profile) ===')
process.env.DSH_HOME = 'C:\\Users\\awesome\\.dsh'
const rdr = _market.runtimeDepsReachable('dsh-better-sidebar')
check(rdr === true, `runtimeDepsReachable(dsh-better-sidebar) = ${rdr}`)

// ── 3) planInstall npm-preference ──
console.log('\n=== 3) planInstall (npm preference) ===')
const plugins = ['omdsh-dev/DSH-better-sidebar', 'omdsh-dev/dsh-genui', 'omdsh-dev/dsh-at-file', 'liustack/modlens']
const plans = {}
for (const p of plugins) {
  plans[p] = await _market.planInstall(p)
  console.log(`  ${p} -> ${JSON.stringify(plans[p])}`)
}
check(plans['omdsh-dev/DSH-better-sidebar'].spec && /^dsh-better-sidebar@/.test(plans['omdsh-dev/DSH-better-sidebar'].spec), 'DSH-better-sidebar -> npm spec dsh-better-sidebar@x')
check(plans['liustack/modlens'].spec && /^@liustack\/modlens@/.test(plans['liustack/modlens'].spec), 'modlens -> npm spec @liustack/modlens@x')
check(plans['omdsh-dev/dsh-at-file'].spec === 'omdsh-dev/dsh-at-file', 'dsh-at-file -> not published on npm, falls back to github spec')
check(plans['omdsh-dev/dsh-genui'].spec === 'omdsh-dev/dsh-genui', 'dsh-genui -> not published on npm, falls back to github spec')

// ── 4) install-test all 4 on a throwaway profile ──
console.log('\n=== 4) install-test on throwaway profile ===')
const tmpBase = join(os.tmpdir(), 'dsh-mkt-upgrade-' + process.pid)
const tmpHome = join(tmpBase, 'dsh')
const profileDir = join(tmpHome, 'profiles', 'web')
rmSync(tmpBase, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-web-test', private: true, dsh: { profile: { bundles: [] } }, dependencies: {} }, null, 2))
writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
process.env.DSH_HOME = tmpHome

const results = {}
for (const p of plugins) {
  const before = Object.keys((() => { try { return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies || {} } catch { return {} } })())
  const started = _market.startInstall(p)
  if (started.error) { console.log(`  ${p}: REFUSED ${started.error}`); results[p] = false; allPass = false; continue }
  const result = await started.job.result
  results[p] = !!result.ok
  console.log(`  ${p}: ok=${result.ok} installed=${result.installed} error=${result.error || ''}`)
  if (result.ok) {
    // package name is whatever pnpm actually added (spec may be owner/repo or npm spec)
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const added = Object.keys(manifest.dependencies || {}).filter((n) => !before.includes(n))
    const name = added[0]
    const bundles = manifest.dsh?.profile?.bundles || []
    const inBundles = name ? bundles.includes(name) : false
    const entry = name ? (() => { const nm = join(profileDir, 'node_modules', name); const pkg = (() => { try { return JSON.parse(readFileSync(join(nm, 'package.json'), 'utf8')) } catch { return null } })(); if (!pkg) return false; if (pkg.main) return existsSync(join(nm, String(pkg.main).split('/').join('\\'))); return true })() : false
    console.log(`    name=${name} dep=${manifest.dependencies?.[name]} inBundles=${inBundles} entryOk=${entry}`)
    if (!inBundles || !entry) { results[p] = false; allPass = false }
  } else {
    allPass = false
    console.log('    output tail:', (result.output || '').slice(-500))
  }
}

console.log('\n=== RESULT ===')
for (const p of plugins) console.log(`  ${p}: ${results[p] ? 'PASS' : 'FAIL'}`)
console.log(allPass ? 'ALL PASS' : 'SOME FAILED')
process.exit(allPass ? 0 : 1)
