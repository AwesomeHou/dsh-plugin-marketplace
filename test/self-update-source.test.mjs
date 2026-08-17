/**
 * Regression test for issue #3: the marketplace's SELF-update must never resolve
 * the bare npm package name (owned by an unrelated author — Scorp1o117's
 * `dsh-plugin-marketplace`). When installed from a URL/tarball spec, the update
 * source must come from the installed package's declared GitHub repository, so
 * the version check and the install always point at the same source.
 *
 * Uses a throwaway profile under <workspace>/.test-tmp; no network installs run
 * (jobs are canceled before they execute).
 */
import { _market } from '../lib/index.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const tmpBase = join(os.tmpdir(), 'dsh-mkt-self-' + process.pid)
const profileDir = join(tmpBase, 'profiles', 'web')
rmSync(tmpBase, { recursive: true, force: true })
mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-marketplace'), { recursive: true })
mkdirSync(join(profileDir, 'node_modules', 'plain-npm-plugin'), { recursive: true })
mkdirSync(join(profileDir, 'node_modules', 'url-no-repo'), { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web-test', private: true,
  dsh: { profile: { bundles: ['dsh-plugin-marketplace'] } },
  dependencies: {
    // issue #3 scenario: installed from a codeload tarball URL, declared repo = AwesomeHou
    'dsh-plugin-marketplace': 'https://codeload.github.com/AwesomeHou/dsh-plugin-marketplace/tar.gz/refs/heads/master',
    // plain npm range with no declared repo — behavior must stay name@latest
    'plain-npm-plugin': '^1.0.0',
    // URL spec with no declared repo — must refuse, not fall back to npm name
    'url-no-repo': 'https://example.com/packs/url-no-repo.tgz',
  },
}))
writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
const writeInst = (name, pkg) => writeFileSync(join(profileDir, 'node_modules', name, 'package.json'), JSON.stringify(pkg))
writeInst('dsh-plugin-marketplace', {
  name: 'dsh-plugin-marketplace', version: '0.2.0',
  repository: 'https://github.com/AwesomeHou/dsh-plugin-marketplace.git',
  dsh: { client: { platform: 'web' } },
})
writeInst('plain-npm-plugin', { name: 'plain-npm-plugin', version: '1.0.0' })
writeInst('url-no-repo', { name: 'url-no-repo', version: '1.0.0' })
process.env.DSH_HOME = tmpBase

let pass = true
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) pass = false }

// 1) URL-spec self update → must target AwesomeHou's GitHub repo (never bare npm name)
console.log('\n=== 1) self (URL spec) update source ===')
{
  const r = _market.startUpdate('dsh-plugin-marketplace')
  check(!r.error, 'startUpdate(self) resolves: ' + (r.error || ''))
  if (r.job) {
    check(r.job.spec === 'AwesomeHou/dsh-plugin-marketplace', `update target = ${r.job.spec} (expect AwesomeHou/dsh-plugin-marketplace)`)
    await _market.cancelJob(r.job)
  }
}

// 2) plain npm range without declared repo → still name@latest (unchanged behavior)
console.log('\n=== 2) plain npm spec update source ===')
{
  const r = _market.startUpdate('plain-npm-plugin')
  check(!r.error, 'startUpdate(plain-npm-plugin) resolves: ' + (r.error || ''))
  if (r.job) {
    check(r.job.spec === 'plain-npm-plugin@latest', `update target = ${r.job.spec} (expect plain-npm-plugin@latest)`)
    await _market.cancelJob(r.job)
  }
}

// 3) URL spec with no declared repo → refuse with error (never bare npm name)
console.log('\n=== 3) URL spec without declared repo ===')
{
  const r = _market.startUpdate('url-no-repo')
  check(!!r.error, `startUpdate(url-no-repo) refused: ${r.error || '(no error — BAD)'}`)
  check(!r.job, 'no job was started')
}

console.log(`\n${pass ? 'ALL PASS' : 'SOME FAILED'}`)
rmSync(tmpBase, { recursive: true, force: true })
process.exit(pass ? 0 : 1)
