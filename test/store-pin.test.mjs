/**
 * Unit test for the pnpm store-drift fix (issue: GUI installs die with
 * ERR_PNPM_UNEXPECTED_STORE after DSH Desktop restarts with a different
 * USERPROFILE/LOCALAPPDATA context).
 *
 * Covers:
 *  1. recordedModulesStoreDir — reads the store path out of
 *     node_modules/.modules.yaml (both the JSON-quoted and bare forms pnpm
 *     writes), unescaping backslashes.
 *  2. effectiveStoreDir — strips the trailing \v<major> suffix when adopting
 *     the recorded store, and falls back to <profile>/.pnpm-store on a fresh
 *     profile.
 *  3. storeDirArg — the `--config.store-dir=<dir>` token injected into every
 *     `dsh plugin` invocation (the cross-version mechanism that pins the store),
 *     including the metacharacter-path refusal.
 *  4. classifyPnpmFailure — recognizes the store-drift failures as a
 *     recoverable "unexpected-store" error.
 *
 * Uses a throwaway DSH_HOME under the OS temp dir; never touches the real
 * profile.
 */
import { _market } from '../lib/index.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ws = join(here, '..')
const tmpBase = join(os.tmpdir(), 'dsh-mkt-store-' + process.pid)
const tmpHome = join(tmpBase, 'dsh')
const profileDir = join(tmpHome, 'profiles', 'web')

let allPass = true
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) allPass = false }

process.env.DSH_HOME = tmpHome
rmSync(tmpBase, { recursive: true, force: true })
mkdirSync(join(profileDir, 'node_modules'), { recursive: true })

// ── 1) recordedModulesStoreDir: JSON-quoted form pnpm actually writes ──────
console.log('\n=== 1) recordedModulesStoreDir ===')
const recorded = 'C:\\Users\\.pnpm-store\\v10'
// pnpm dumps .modules.yaml with JSON-escaped strings: `"storeDir": "C:\\…\\v10",`
writeFileSync(join(profileDir, 'node_modules', '.modules.yaml'),
  'hoistPattern:\n  - "*"\n  "storeDir": "C:\\\\Users\\\\.pnpm-store\\\\v10",\n  "virtualStoreDir": "…\\node_modules\\.pnpm",\n')
check(_market.recordedModulesStoreDir() === recorded,
  `recordedModulesStoreDir (JSON-quoted) = ${_market.recordedModulesStoreDir()} (exp ${recorded})`)

// bare unquoted form (older/newer pnpm writers)
writeFileSync(join(profileDir, 'node_modules', '.modules.yaml'),
  'hoistPattern:\n  - "*"\nstoreDir: C:\\Users\\legacy\\.pnpm-store\\v10\n')
check(_market.recordedModulesStoreDir() === 'C:\\Users\\legacy\\.pnpm-store\\v10',
  `recordedModulesStoreDir (bare) = ${_market.recordedModulesStoreDir()} (exp C:\\Users\\legacy\\.pnpm-store\\v10)`)

// no .modules.yaml → null
rmSync(join(profileDir, 'node_modules', '.modules.yaml'), { force: true })
check(_market.recordedModulesStoreDir() === null, 'recordedModulesStoreDir (absent) = null')

// ── 2) effectiveStoreDir: adopt (strip \v<major>) vs fresh default ─────────
console.log('\n=== 2) effectiveStoreDir ===')
writeFileSync(join(profileDir, 'node_modules', '.modules.yaml'),
  '  "storeDir": "C:\\\\Users\\\\.pnpm-store\\\\v10",\n')
check(_market.effectiveStoreDir() === 'C:\\Users\\.pnpm-store',
  `effectiveStoreDir strips \\v10 -> ${_market.effectiveStoreDir()}`)

rmSync(join(profileDir, 'node_modules', '.modules.yaml'), { force: true })
check(_market.effectiveStoreDir() === join(profileDir, '.pnpm-store'),
  `effectiveStoreDir fresh -> ${_market.effectiveStoreDir()}`)

// ── 3) storeDirArg: the --config.store-dir token injected into dsh plugin ──
console.log('\n=== 3) storeDirArg ===')
// Drift scenario: recorded store exists → adopt its base as the flag value.
writeFileSync(join(profileDir, 'node_modules', '.modules.yaml'),
  '  "storeDir": "C:\\\\Users\\\\.pnpm-store\\\\v10",\n')
check(_market.storeDirArg() === '--config.store-dir=C:\\Users\\.pnpm-store',
  `storeDirArg adopts recorded base -> ${_market.storeDirArg()}`)

// Fresh profile (no .modules.yaml) → deterministic per-profile default.
rmSync(join(profileDir, 'node_modules', '.modules.yaml'), { force: true })
check(_market.storeDirArg() === '--config.store-dir=' + join(profileDir, '.pnpm-store'),
  `storeDirArg fresh -> ${_market.storeDirArg()}`)

// A store path with shell metacharacters is refused (never injected).
writeFileSync(join(profileDir, 'node_modules', '.modules.yaml'),
  '  "storeDir": "C:\\\\Users\\\\Bad&Store\\\\.pnpm-store\\\\v10",\n')
check(_market.storeDirArg() === null, 'storeDirArg refuses metacharacter paths')

// ── 4) classifyPnpmFailure recognizes the store-drift failures ─────────────
console.log('\n=== 4) classifyPnpmFailure (store drift) ===')
const realMsg = 'ERR_PNPM_UNEXPECTED_STORE The dependencies at "C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules" are currently linked from the store at "C:\\Users\\.pnpm-store\\v10".\n\npnpm now wants to use the store at "C:\\Users\\Administrator\\AppData\\Local\\pnpm\\store\\v10" to link dependencies.\n\nIf you want to use the new store location, reinstall your dependencies with "pnpm install".'
const cls1 = _market.classifyPnpmFailure(realMsg)
check(cls1 && cls1.code === 'unexpected-store' && cls1.recoverable === true, `classify UNEXPECTED_STORE -> ${cls1 && cls1.code}`)
const cls2 = _market.classifyPnpmFailure('ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY Aborted removal of modules directory due to no TTY')
check(cls2 && cls2.code === 'unexpected-store' && cls2.recoverable === true, `classify ABORTED_REMOVE... -> ${cls2 && cls2.code}`)
check(_market.classifyPnpmFailure('some unrelated output') === null, 'classify unrelated -> null')

rmSync(tmpBase, { recursive: true, force: true })
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED')
process.exit(allPass ? 0 : 1)
