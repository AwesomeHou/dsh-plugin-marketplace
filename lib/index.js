/**
 * dsh-plugin-marketplace — Host half.
 *
 * A permanent (bundle) plugin that syncs the GitHub `dsh-plugin` topic into a
 * cached JSON feed and exposes model tools, so both the settings UI and the
 * agent itself can discover, install, update and manage plugins.
 *
 * Data:
 * - GitHub Search API `q=topic:dsh-plugin` is paginated (`per_page` max 100).
 *   The full topic holds 1800+ repos; we cache pages on demand so the UI can
 *   "load more" and search can narrow the whole set via GitHub's own `q`.
 * - Served over `ctx.webServer` at `GET /api/market/list`:
 *   `?q=<kw>&page=<n>&per_page=<n>` → `{ items, total, page, perPage, hasMore,
 *   fetchedAt, error }`.
 * - `POST /api/market/install` with `{ spec }` → starts an async install job
 *   and returns `{ ok, jobId }` immediately (202). Progress is polled at
 *   `GET /api/market/install/status?job=<id>` and cancelled at
 *   `POST /api/market/install/cancel`. The final result mirrors the old shape
 *   `{ ok, installed, output, requiresRestart, error, jobId }`.
 * - `GET /api/market/installed` → the web profile's plugin inventory
 *   `{ plugins, self, fetchedAt }`. Each plugin carries `kind`
 *   (`builtin` = ships with the profile template, `installed` = added later),
 *   `enabled`, `version`, `latestVersion` and `updateAvailable`.
 * - `POST /api/market/update` `{ name }` → starts an async update job
 *   (`{ ok, jobId }`), progress via the same status endpoint.
 * - `POST /api/market/set-enabled` `{ name, enabled }` → 关闭/启用 an installed
 *   plugin (toggles it in/out of the profile's active bundle layer list).
 * - `POST /api/market/uninstall` `{ name }` → remove an installed plugin.
 *
 * Why installs are asynchronous now:
 * - The old path ran `spawnSync` (blocking the whole web server's event loop
 *   for the full install — the settings UI froze with zero feedback).
 * - `dsh plugin` itself runs pnpm with `spawnSync` and no timeout; the outer
 *   120s timeout could not kill the process tree on Windows (killing `cmd.exe`
 *   leaves dsh→pnpm→node/git alive, their inherited pipes keep `spawnSync`
 *   blocked forever), so the UI showed "安装中…" indefinitely.
 * - Now the child runs async with `spawn`, progress is streamed back, a real
 *   `taskkill /T /F` (or `kill(-pid)`) can abort the whole tree, and a
 *   byte-counting loopback proxy relays the child's traffic to report real
 *   downloaded bytes + transfer speed. Install/update jobs are serialized so
 *   concurrent writes never fight over the profile's package.json.
 *
 * Model tools (registered via `ctx.tools.register`):
 * - `market_search` — search the topic (keyword + pagination), JSON list.
 * - `market_install` — install a plugin into the web profile via
 *   `dsh plugin --profile web add <spec>` (spawned through `node:child_process`).
 * - `market_installed` — list installed plugins + their update availability.
 * - `market_update` — update an installed plugin to its latest version.
 *
 * Unlike a dynamic plugin there is no `harness`/`host.call` sandbox here; this
 * is a plain Node module with full access to Node built-ins and the web app's
 * own HTTP server.
 */
import { spawn } from 'node:child_process'
import { createServer as createNetServer, connect as netConnect } from 'node:net'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

const TOPIC_QUERY = 'topic:dsh-plugin'
const GITHUB_API = 'https://api.github.com/search/repositories'
const REFRESH_MS = 10 * 60 * 1000
const DEFAULT_PER_PAGE = 50
const MAX_PER_PAGE = 100

// ── latest-version discovery (registry / GitHub HEAD, cached) ─────────────
const LATEST_TTL_MS = 15 * 60 * 1000
const latestCache = new Map() // key -> { version, at }

/** Resolve the active web profile directory (honors DSH_HOME, else ~/.dsh). */
function webProfileDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
}

/** Read the web profile manifest (package.json), or null when absent/invalid. */
function profileManifest() {
  const path = join(webProfileDir(), 'package.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/** Write the profile manifest in the same shape the `dsh` CLI uses. */
function writeProfileManifestFile(manifest) {
  writeFileSync(join(webProfileDir(), 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
}

/** Read one installed package's manifest from the profile node_modules. */
function installedManifest(name) {
  const rel = String(name || '').split('/')
  const path = join(webProfileDir(), 'node_modules', ...rel, 'package.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/** This plugin's own package manifest (works from either a link or a registry install). */
function ownPackageJson() {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) } catch {
    return { name: 'dsh-plugin-marketplace', version: '0.0.0', repository: null }
  }
}

/** Normalize a manifest `repository` field to a `owner/repo` spec, or null. */
function repositoryGitHubSpec(manifest) {
  if (!manifest) return null
  const repo = manifest.repository
  const url = typeof repo === 'string' ? repo : (repo && typeof repo.url === 'string' ? repo.url : null)
  return url ? githubSpec(url) : null
}

/** Extract an `owner/repo` pair from any GitHub-ish dependency spec, or null. */
function githubSpec(spec) {
  const s = String(spec || '').trim()
  if (!s) return null
  // github:owner/repo[#commit] — the ref is everything before a '#', which may
  // itself contain a slash, so a trailing [/#…] group must not eat the repo.
  let m = /^github:(?<ref>[^#]+?)(?:#.*)?$/.exec(s)
  if (m) { const ref = m.groups.ref.trim(); return /^[^/]+\/[^/]+$/.test(ref) ? ref : null }
  m = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:www\.)?github\.com\/(?<ref>[^/]+\/[^/.]+?)(?:\.git)?(?:[#/].*)?$/i.exec(s)
  if (m) return m.groups.ref
  m = /^git@github\.com:(?<ref>[^/]+\/[^/.]+?)(?:\.git)?$/.exec(s)
  if (m) return m.groups.ref
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) return s
  return null
}

/** Whether a dependency spec points at a local path (link:/file:/./.. or absolute). */
function isLocalSpec(spec) {
  const s = String(spec || '').trim()
  return /^(link|file):/i.test(s) || /^[.]{1,2}[\\/]/.test(s) || /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]/.test(s)
}

/** Minimal semver core parsing; returns null for non-semver strings. */
function parseVersion(v) {
  const s = String(v || '').trim().replace(/^v/i, '')
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : null }
}

/**
 * a > b under semver precedence. Returns null when either side is not semver
 * (the caller then treats the comparison as unknown, not "newer").
 */
function versionGt(a, b) {
  const A = parseVersion(a)
  const B = parseVersion(b)
  if (!A || !B) return null
  if (A.major !== B.major) return A.major > B.major
  if (A.minor !== B.minor) return A.minor > B.minor
  if (A.patch !== B.patch) return A.patch > B.patch
  if (!A.pre && !B.pre) return false
  if (A.pre && !B.pre) return false
  if (!A.pre && B.pre) return true
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i]
    const y = B.pre[i]
    if (x === undefined) return false
    if (y === undefined) return true
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) { if (+x !== +y) return +x > +y; continue }
    if (xn) return false
    if (yn) return true
    if (x !== y) return x > y
  }
  return false
}

/** Latest published version of an npm package (registry dist-tag `latest`). */
async function latestFromNpm(name) {
  const key = 'npm:' + name
  const hit = latestCache.get(key)
  if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.version
  let version = null
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      headers: { 'User-Agent': 'dsh-plugin-marketplace' },
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const data = await res.json()
      if (data && typeof data.version === 'string') version = data.version
    }
  } catch { /* registry unreachable — treat as unknown */ }
  latestCache.set(key, { version, at: Date.now() })
  return version
}

/**
 * Latest version of a GitHub repo: the `version` field of its default-branch
 * `package.json` (plugins bump it per release), falling back to the latest
 * release tag.
 */
async function latestFromGithub(ownerRepo) {
  const key = 'gh:' + ownerRepo
  const hit = latestCache.get(key)
  if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.version
  let version = null
  const [owner, repo] = String(ownerRepo).split('/')
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`, {
      headers: { 'User-Agent': 'dsh-plugin-marketplace', 'Accept': 'application/vnd.github.raw+json' },
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const data = await res.json()
      if (data && typeof data.version === 'string') version = data.version
    }
  } catch { /* ignore */ }
  if (!version) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'dsh-plugin-marketplace', 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data && typeof data.tag_name === 'string') version = String(data.tag_name).replace(/^v/i, '')
      }
    } catch { /* ignore */ }
  }
  latestCache.set(key, { version, at: Date.now() })
  return version
}

/** Latest version for an installed dependency, by its spec shape. */
async function resolveLatest(name, spec, inst) {
  const gh = githubSpec(spec)
  if (gh) return await latestFromGithub(gh)
  if (isLocalSpec(spec)) {
    // Local links have no remote tag of their own; use their declared GitHub
    // repository (this is how the marketplace checks its own updates).
    const repoGh = repositoryGitHubSpec(inst)
    if (repoGh) return await latestFromGithub(repoGh)
    return inst && typeof inst.version === 'string' ? inst.version : null
  }
  return await latestFromNpm(name)
}

/**
 * Locate the `dsh` CLI to delegate plugin management to. The web app runs
 * in-process as `dsh web`, so it is often launched through a
 * `node_modules/.bin` shim whose directory is NOT on the system PATH — a
 * child `cmd.exe /c dsh …` then fails with "'dsh' is not recognized".
 * Resolution order:
 *   1. the running harness's own bin script (`process.argv[1]` is
 *      `<root>/node_modules/@deepseek-ai/dsh/lib/bin.js` when launched via a
 *      shim) → spawn that same install's `.bin` shim (or, without a shim, run
 *      the bin script through the harness's own Node);
 *   2. a compiled single-file `dsh` binary (`process.execPath` is dsh itself);
 *   3. a PATH lookup (globally/locally installed dsh);
 *   4. the bare name as a last resort (the shell reports it missing).
 * @returns command tokens for the `dsh` invocation, each safe inside double
 *   quotes in a shell command line (e.g. `[dsh.cmd]` or `[node, bin.js]`).
 */
function resolveDshCommand() {
  // 1) Running harness = `dsh <profile>` in-process via a node_modules shim.
  const argv1 = process.argv && process.argv[1]
  if (argv1) {
    const m = /^(.+)[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/.exec(String(argv1).replace(/\\/g, '/'))
    if (m) {
      const nm = join(m[1], 'node_modules')
      const shim = join(nm, '.bin', 'dsh' + (process.platform === 'win32' ? '.cmd' : ''))
      if (existsSync(shim)) return [shim]
      const bin = join(nm, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (existsSync(bin)) return [process.execPath, bin]
    }
  }
  // 2) Compiled single-file `dsh` binary: process.execPath is the binary.
  const execName = String(process.execPath || '').replace(/\\/g, '/').split('/').pop()
  if (/^dsh(\.exe)?$/i.test(execName || '')) return [process.execPath]
  // 3) PATH lookup across the usual executable extensions.
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of String(process.env.PATH || '').split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, 'dsh' + ext)
      if (existsSync(candidate)) return [candidate]
    }
  }
  // 4) Last resort: let the shell resolve it (reports "not found" if absent).
  return ['dsh']
}

// ═══════════════════════════════════════════════════════════════════════════
// Async install/update jobs with live progress
// ═══════════════════════════════════════════════════════════════════════════

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000 // hard cap; child tree is killed after this
const JOBS = new Map() // id -> job
let jobSeq = 0
let installQueue = Promise.resolve() // serializes install/update/remove writes

/** Format a byte count for humans (host-side; the client has its own). */
function fmtBytes(n) {
  n = Number(n) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

/**
 * Kill a process tree. Windows: `taskkill /pid <pid> /T /F` (the only reliable
 * way to kill cmd → dsh → pnpm → node/git trees — plain `kill()` only hits the
 * top `cmd.exe` and leaves orphans holding the stdio pipes). POSIX: negative
 * pid to signal the whole group.
 */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) { resolve(); return }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => resolve())
      killer.on('exit', () => resolve())
    } else {
      try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
      resolve()
    }
  })
}

/**
 * A tiny loopback TCP relay that doubles as a byte counter. The spawned
 * child is pointed at it via HTTP(S)_PROXY; every CONNECT tunnel (HTTPS) and
 * plain-HTTP request is relayed verbatim, so the child's real downloaded byte
 * count and transfer speed can be reported. It must NEVER break the install:
 * all errors only close the affected sockets (stats freeze, install continues).
 * @returns Promise<{ url, stats(): {bytesDown,bytesUp,expectedBytes,speedBps}, close() }>
 */
function createByteProxy() {
  const state = { bytesDown: 0, bytesUp: 0, expectedBytes: 0, speedBps: 0 }
  let lastAt = Date.now()
  let lastBytes = 0
  const timer = setInterval(() => {
    const now = Date.now()
    const dt = now - lastAt
    if (dt >= 500) {
      state.speedBps = dt > 0 ? Math.round(((state.bytesDown - lastBytes) * 1000) / dt) : 0
      lastAt = now
      lastBytes = state.bytesDown
    }
  }, 500)
  const server = createNetServer((client) => {
    let buf = Buffer.alloc(0)
    let target = null
    client.on('error', () => {})
    client.on('data', (chunk) => {
      if (target) { state.bytesUp += chunk.length; return }
      buf = Buffer.concat([buf, chunk])
      if (buf.length > 65536) { client.destroy(); return }
      const headEnd = buf.indexOf('\r\n\r\n')
      if (headEnd === -1) return // wait for the full header terminator before deciding the target
      const head = buf.subarray(0, headEnd).toString('utf8')
      const firstLineEnd = head.indexOf('\r\n')
      const requestLine = firstLineEnd === -1 ? head : head.slice(0, firstLineEnd)
      const parts = requestLine.split(' ')
      let host, port, isConnect, toSend
      if (parts[0] === 'CONNECT' && parts[1]) {
        // CONNECT tunnel: only bytes AFTER the header terminator belong to the
        // (TLS) stream — forwarding the remaining CONNECT headers would corrupt
        // the TLS handshake (EPROTO).
        const [h, p] = parts[1].split(':')
        host = h
        port = parseInt(p, 10) || 443
        isConnect = true
        toSend = buf.subarray(headEnd + 4)
      } else {
        const hostM = /^Host:\s*(\S+)/im.exec(head)
        if (!hostM) { client.destroy(); return }
        const h = hostM[1].trim()
        if (h.startsWith('[')) { host = h.slice(1, h.indexOf(']')); port = 80 }
        else if (h.split(':').length === 2) { const [hh, pp] = h.split(':'); host = hh; port = parseInt(pp, 10) || 80 }
        else { host = h; port = 80 }
        isConnect = false
        toSend = buf
      }
      target = { host, port }
      const up = netConnect(port, host, () => {
        if (isConnect) client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (toSend.length) up.write(toSend)
        buf = Buffer.alloc(0)
        client.pipe(up)
        up.pipe(client)
        up.on('data', (c) => { state.bytesDown += c.length })
        client.on('data', (c) => { state.bytesUp += c.length })
      })
      up.on('error', () => client.destroy())
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      server.on('error', () => {}) // post-listen connection-level noise
      const port = server.address().port
      resolve({
        url: `http://127.0.0.1:${port}`,
        stats: () => ({ bytesDown: state.bytesDown, bytesUp: state.bytesUp, expectedBytes: state.expectedBytes, speedBps: state.speedBps }),
        close: () => { clearInterval(timer); try { server.close() } catch { /* noop */ } },
      })
    })
  })
}

/** Quote shell tokens into one command line (each wrapped in double quotes). */
function quote(args) {
  return args.map((a) => `"${a}"`).join(' ')
}

/**
 * Quote only the tokens that need it. The all-quoted form (`"corepack"
 * "pnpm" …`) is parsed wrongly by `cmd /s /c` for PATH-resolved bare commands,
 * so commands resolved through PATH (git, corepack/pnpm) must stay unquoted
 * unless a token actually contains whitespace or metacharacters.
 */
function quoteSmart(args) {
  return args.map((a) => (/[\s"&|<>^()%!]/.test(a) ? `"${a}"` : a)).join(' ')
}

/**
 * Run one shell command asynchronously, streaming each output line to
 * `onLine`. Returns `{ promise, kill }`; `kill()` aborts the whole tree
 * (timeout / cancel). Used for every subprocess (dsh, git, pnpm).
 */
function runProc(commandString, { cwd, env, onLine } = {}) {
  let child = null
  const promise = new Promise((resolve) => {
    child = spawn(commandString, [], {
      cwd,
      env,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let buf = ''
    const feed = (chunk) => {
      output += chunk
      buf += chunk
      let idx
      while ((idx = buf.search(/\r?\n|\r/)) !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + (buf[idx] === '\r' && buf[idx + 1] === '\n' ? 2 : 1))
        if (line) { try { if (onLine) onLine(line) } catch { /* progress parsing must never break the install */ } }
      }
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (err) => resolve({ ok: false, code: null, output, error: err.message }))
    child.on('close', (code) => {
      if (buf.trim()) { try { if (onLine) onLine(buf.trim()) } catch { /* noop */ } output += buf }
      resolve({ ok: code === 0, code, output })
    })
  })
  return { promise, kill: () => killTree(child && child.pid) }
}

/**
 * Run one `dsh plugin --profile web …` invocation asynchronously, streaming
 * each output line to `onLine`. Returns `{ promise, kill }`; `kill()` aborts
 * the whole tree (timeout / cancel).
 */
function runDshAsync(args, { env, onLine } = {}) {
  const dshTokens = resolveDshCommand()
  return runProc(quote([...dshTokens, 'plugin', '--profile', 'web', ...args]), { env, onLine })
}

/** Run a quick `dsh plugin` command with no progress reporting (e.g. remove). */
async function runDshSimple(args) {
  const profileDir = webProfileDir()
  if (!existsSync(join(profileDir, 'package.json'))) {
    return { ok: false, output: '', error: `web profile not found at ${profileDir}` }
  }
  const bad = args.find((a) => typeof a !== 'string' || /[&|<>^()%"'!]/.test(a))
  if (bad !== undefined) return { ok: false, output: '', error: 'argument contains shell metacharacters and was refused' }
  const run = runDshAsync(args, {})
  const r = await run.promise
  const output = (r.output || '').trim()
  if (!r.ok && /(not recognized as an internal|command not found|不是内部或外部命令)/i.test(output)) {
    return { ok: false, output, error: `找不到 dsh 可执行文件（已尝试解析为 ${resolveDshCommand().join(' ')}）。请把 dsh 加入 PATH，或通过 dsh CLI 启动 harness 后重试。` }
  }
  return { ok: r.ok, output, error: r.ok ? null : (r.error || `exit ${r.code}`) }
}

function createJob(kind, spec, name) {
  const id = 'job-' + (++jobSeq) + '-' + Date.now().toString(36)
  const job = {
    id,
    kind, // 'install' | 'update'
    spec: spec || '',
    name: name || null,
    phase: 'pending',
    step: null, // human-readable sub-step label (clone / build / register …)
    depsBefore: null, // dependency-name snapshot taken before a standard `add`
    percent: null,
    packages: { resolved: 0, reused: 0, downloaded: 0, added: 0 },
    bytesDown: 0,
    bytesTotal: null, // best-effort estimate (registry unpacked sizes) / plain-HTTP Content-Length sums
    speedBps: 0,
    log: [],
    output: '',
    startedAt: Date.now(),
    done: false,
    ok: null,
    error: null,
    canceled: false,
    timedOut: false,
    requiresRestart: true,
    childKill: null,
    proxy: null,
    resultResolve: null,
  }
  job.result = new Promise((resolve) => { job.resultResolve = resolve })
  return job
}

/** Recompute the 0–100 progress percent from phase + package counts (+ bytes). */
function updatePercent(job) {
  if (job.phase === 'done') { job.percent = 100; return }
  const p = job.packages
  let pct = null
  if (job.phase === 'downloading' && p.resolved > 0) {
    pct = Math.max(2, Math.min(96, Math.round((100 * (p.reused + p.downloaded)) / p.resolved)))
  } else if (job.phase === 'installing') {
    const frac = p.resolved > 0 ? Math.min(1, p.added / p.resolved) : 0
    pct = Math.min(99, Math.round(96 + 3 * frac))
  } else if (job.phase === 'resolving') {
    pct = Math.max(job.percent || 0, 8)
  }
  if (pct === null && job.bytesTotal > 0) {
    pct = Math.max(2, Math.min(96, Math.round((100 * job.bytesDown) / job.bytesTotal)))
  }
  if (pct !== null) job.percent = pct
}

/** Feed one pnpm/dsh output line into the job: phase + package counters. */
function handleLine(job, line) {
  job.log.push(line)
  if (job.log.length > 80) job.log.splice(0, job.log.length - 80)
  job.output += line + '\n'
  if (job.output.length > 20000) job.output = job.output.slice(-16000)
  let m = /Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/.exec(line)
  if (m) {
    job.packages = { resolved: +m[1], reused: +m[2], downloaded: +m[3], added: +m[4] }
    // pnpm bumps `added` while linking/installing packages after downloads, so
    // a growing `added` counter means we are in the install (linking) phase.
    if (job.packages.added > 0) job.phase = 'installing'
    else if (job.packages.downloaded > 0 || job.packages.resolved > job.packages.reused) job.phase = 'downloading'
    else if (job.packages.resolved > 0) job.phase = 'resolving'
    updatePercent(job)
    return
  }
  if (/^Packages: \+/.test(line) || /\s(?:postinstall|preinstall|install)\$/.test(line)) {
    job.phase = 'installing'
    updatePercent(job)
    return
  }
  if (/^Done in /.test(line)) { job.phase = 'done'; job.percent = 100 }
}

/** Best-effort total download size: sum of direct deps' registry tarball sizes. */
async function estimateTotal(job) {
  try {
    let deps = {}
    const gh = githubSpec(job.spec)
    if (gh) {
      const [owner, repo] = gh.split('/')
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`, {
        headers: { 'User-Agent': 'dsh-plugin-marketplace' },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const pkg = await res.json()
        deps = (pkg && pkg.dependencies) || {}
      }
    } else if (/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(job.spec) && !isLocalSpec(job.spec)) {
      deps[job.spec] = 'latest'
    }
    let total = 0
    for (const dep of Object.keys(deps)) {
      try {
        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(dep)}/latest`, {
          headers: { 'User-Agent': 'dsh-plugin-marketplace' },
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) {
          const d = await res.json()
          const size = d && d.dist && (Number(d.dist.size) || Number(d.dist.unpackedSize))
          if (size > 0) total += size
        }
      } catch { /* skip unreachable package */ }
    }
    if (total > 0) job.bytesTotal = total
  } catch { /* estimate is best-effort */ }
}

/** Live snapshot for the status endpoint / browser poller. */
function snapshotOf(job) {
  const elapsedMs = Date.now() - job.startedAt
  let etaSec = null
  if (typeof job.percent === 'number' && job.percent > 0 && job.percent < 100) {
    etaSec = Math.max(1, Math.round(((elapsedMs / job.percent) * (100 - job.percent)) / 1000))
  }
  return {
    id: job.id,
    kind: job.kind,
    spec: job.spec,
    name: job.name,
    phase: job.phase,
    step: job.step,
    percent: job.percent,
    packages: { ...job.packages },
    bytesDown: job.bytesDown,
    bytesTotal: job.bytesTotal,
    speedBps: job.speedBps,
    elapsedMs,
    etaSec,
    log: job.log.slice(-8),
    done: job.done,
    ok: job.ok,
    error: job.error,
    requiresRestart: job.requiresRestart,
    output: job.done ? job.output : job.output.slice(-2000),
  }
}

function finishJob(job, r) {
  if (job.done) return
  job.done = true
  if (job.canceled) {
    job.ok = false
    job.phase = 'canceled'
    job.percent = job.percent || 0
    job.error = job.error || '安装已取消'
  } else if (job.timedOut) {
    job.ok = false
    job.phase = 'error'
    job.error = job.error || '安装超时'
  } else if (r.ok) {
    job.ok = true
    job.phase = 'done'
    job.percent = 100
  } else {
    job.ok = false
    job.phase = 'error'
    job.error = r.error || `exit ${r.code}`
  }
  job.output = job.output.trim()
  // Keep the job readable for a grace period so a still-polling browser gets
  // the final snapshot, then drop it.
  setTimeout(() => { if (JOBS.get(job.id) === job) JOBS.delete(job.id) }, 5 * 60 * 1000).unref?.()
  const base = { ok: job.ok, output: job.output, requiresRestart: job.requiresRestart, error: job.ok ? null : job.error, jobId: job.id, phase: job.phase }
  const installedName = (r && r.installed) || job.spec
  job.resultResolve(job.kind === 'update' || job.kind === 'update-workspace'
    ? { ...base, name: job.name || installedName, installed: installedName }
    : { ...base, installed: installedName })
}

async function cancelJob(job) {
  if (job.done) return { ok: true, already: true }
  job.canceled = true
  job.phase = 'canceled'
  if (job.childKill) await job.childKill()
  return { ok: true }
}

/** Start a serialized install/update job. Returns the job object. */
function startJob(kind, spec, name) {
  const job = createJob(kind, spec, name)
  JOBS.set(job.id, job)
  const run = installQueue.then(() => executeJob(job), () => executeJob(job))
  installQueue = run.catch(() => {})
  return job
}

// ── Monorepo-aware install ────────────────────────────────────────────────
// A `github:owner/repo` spec that points at a workspace root (the root
// package.json declares no `dsh.bundle`) installs a useless plain dependency:
// the real plugin lives in a sub-package that must be cloned, built and then
// linked into the profile. This is exactly what the repo's own install script
// does (`pnpm --filter <plugin> run build` + `dsh plugin add <name>@link:<dir>`).

/** Find `name` on PATH (any executable extension). */
function whichInPath(name) {
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  const sepChar = process.platform === 'win32' ? ';' : ':'
  for (const dir of String(process.env.PATH || '').split(sepChar)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** pnpm command tokens for building plugin workspaces: prefer corepack. */
function resolvePnpmCommand() {
  return whichInPath('corepack') ? ['corepack', 'pnpm'] : ['pnpm']
}

/** Walk a tree for package.json files declaring a DSH plugin. */
function findPluginPackages(root, depth = 0) {
  const found = []
  if (depth > 8) return found
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return found }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.pnpm' || ent.name === 'dist' || ent.name === 'coverage') continue
    const abs = join(root, ent.name)
    if (ent.isDirectory()) {
      found.push(...findPluginPackages(abs, depth + 1))
    } else if (ent.name === 'package.json') {
      try {
        const pkg = JSON.parse(readFileSync(abs, 'utf8'))
        if (pkg && pkg.dsh && (pkg.dsh.bundle?.patch !== undefined || pkg.dsh.client !== undefined)) {
          found.push({ name: String(pkg.name || ''), dir: dirname(abs), pkg })
        }
      } catch { /* skip unreadable package.json */ }
    }
  }
  return found
}

/** Whether a plugin package needs a build (declared main entry missing). */
function needsBuild(p) {
  const main = p && p.pkg && p.pkg.main
  if (!main) return false
  return !existsSync(join(p.dir, String(main).split('/').join(sep)))
}

/**
 * Whether an installed plugin is actually loadable after a restart: it must be
 * present in `dsh.profile.bundles` (the loader only boots bundle layers) and
 * its bundle patch / main entry must physically exist. This is the marketplace's
 * definition of a REAL install — a package that only landed in `dependencies`
 * (e.g. a monorepo workspace root) is NOT an installed plugin.
 */
function pluginLoadable(name) {
  const manifest = profileManifest()
  if (!manifest) return false
  const bundles = Array.isArray(manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles
    : []
  if (!bundles.includes(name)) return false
  const inst = installedManifest(name)
  if (!inst) return false
  const base = join(webProfileDir(), 'node_modules', ...String(name).split('/'))
  if (inst.dsh && inst.dsh.bundle && inst.dsh.bundle.patch !== undefined) {
    const patchPath = join(base, String(inst.dsh.bundle.patch).split('/').join(sep))
    if (!existsSync(patchPath)) return false
  }
  if (inst.main) {
    const mainPath = join(base, String(inst.main).split('/').join(sep))
    if (!existsSync(mainPath)) return false
  }
  return true
}

/**
 * For a `link:` spec pointing into the marketplace-managed source tree
 * (`$DSH_HOME/marketplace-src/<owner>--<repo>/…`), return the `owner/repo`
 * source, so updates can re-fetch + rebuild + re-link. Null otherwise.
 */
function managedSourceRepo(spec) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const srcRoot = join(home, 'marketplace-src').replace(/\\/g, '/') + '/'
  const t = String(spec || '').replace(/^link:/i, '').replace(/\\/g, '/')
  if (!t.startsWith(srcRoot)) return null
  const m = /^([^/]+)--([^/]+)\//.exec(t.slice(srcRoot.length))
  return m ? `${m[1]}/${m[2]}` : null
}

/**
 * Decide how to install a spec. GitHub repos whose root package.json already
 * declares `dsh.bundle`/`dsh.client` install the normal way; anything else that
 * looks like a GitHub repo goes down the workspace path (its real plugin is a
 * sub-package). Non-GitHub specs always use the standard `add`.
 */
async function planInstall(spec) {
  const gh = githubSpec(spec)
  if (!gh) return { type: 'standard' }
  try {
    const [owner, repo] = gh.split('/')
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`, {
      headers: { 'User-Agent': 'dsh-plugin-marketplace' },
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const pkg = await res.json()
      const isPlugin = !!(pkg && pkg.dsh && (pkg.dsh.bundle?.patch !== undefined || pkg.dsh.client !== undefined))
      return { type: isPlugin ? 'standard' : 'workspace', gh }
    }
  } catch { /* pre-check failed — fall back to standard add + verify */ }
  return { type: 'standard', gh }
}

/**
 * Clone/fetch a GitHub repo into the managed source tree, find its plugin
 * sub-packages, build them if needed and link-install each into the profile.
 * @returns {Promise<{ok, installed, output, error, names?}>}
 */
async function installWorkspacePlugin(job, gh, env, onLine) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const [owner, repo] = String(gh).split('/')
  const srcRoot = join(home, 'marketplace-src')
  const srcDir = join(srcRoot, `${owner}--${repo}`)
  mkdirSync(srcRoot, { recursive: true })
  const gitUrl = `https://github.com/${owner}/${repo}.git`
  const spawnEnv = { ...(env || process.env), COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
  const runStep = (args, cwd) => { const run = runProc(quoteSmart(args), { cwd, env: spawnEnv, onLine }); job.childKill = run.kill; return run.promise }

  // 1) clone or update
  job.phase = 'resolving'
  job.step = '获取仓库源码'
  let r
  if (existsSync(join(srcDir, '.git'))) {
    await runStep(['git', '-C', srcDir, 'fetch', '--depth', '1', 'origin', 'HEAD'], undefined)
    r = await runStep(['git', '-C', srcDir, 'reset', '--hard', 'origin/HEAD'], undefined)
  } else {
    r = await runStep(['git', 'clone', '--depth', '1', gitUrl, srcDir], undefined)
  }
  if (!r.ok) return { ok: false, installed: gh, output: job.output, error: `克隆/更新 ${gh} 失败：${r.error || r.output.slice(-400)}` }

  // 2) align pnpm so the workspace's pinned `packageManager` doesn't reject it
  const pnpmCmd = resolvePnpmCommand()
  const ver = await runStep([...pnpmCmd, '--version'], srcDir)
  let pnpmVersion = null
  const vm = ver.ok ? /v?(\d+\.\d+\.\d+)/.exec(ver.output) : null
  if (vm) pnpmVersion = vm[1]
  if (pnpmVersion) {
    try {
      const rootPkg = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8'))
      if (rootPkg && rootPkg.packageManager) {
        rootPkg.packageManager = `pnpm@${pnpmVersion}`
        writeFileSync(join(srcDir, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n')
      }
    } catch { /* ignore */ }
  }
  const pnpm = pnpmVersion ? [pnpmCmd[0], `pnpm@${pnpmVersion}`] : pnpmCmd

  // 3) find plugin packages
  job.step = '查找插件包'
  const plugins = findPluginPackages(srcDir)
  if (plugins.length === 0) {
    return { ok: false, installed: gh, output: job.output, error: `${gh} 不是可安装的 DSH 插件：仓库中没有找到声明 dsh.bundle / dsh.client 的插件包` }
  }

  // 4) workspace install (deps) + build each plugin that needs it
  job.phase = 'installing'
  job.step = '安装构建依赖'
  r = await runStep([...pnpm, 'install', '--config.node-linker=hoisted'], srcDir)
  if (!r.ok) return { ok: false, installed: gh, output: job.output, error: `安装 ${gh} 构建依赖失败：${r.error || r.output.slice(-600)}` }
  for (const p of plugins) {
    if (needsBuild(p)) {
      job.phase = 'installing'
      job.step = `构建 ${p.name}`
      r = await runStep([...pnpm, '--filter', p.name, 'run', 'build'], srcDir)
      if (!r.ok) return { ok: false, installed: gh, output: job.output, error: `构建 ${p.name} 失败：${r.error || r.output.slice(-600)}` }
      if (needsBuild(p)) return { ok: false, installed: gh, output: job.output, error: `构建 ${p.name} 后仍未生成入口文件（${p.pkg.main}）` }
    }
  }

  // 5) link-install each plugin into the profile (reconcile puts them in bundles)
  const names = []
  for (const p of plugins) {
    job.phase = 'installing'
    job.step = `注册 ${p.name}`
    const linkSpec = 'link:' + p.dir.replace(/\\/g, '/')
    const linkRun = runDshAsync(['add', '-w', linkSpec], { env: spawnEnv, onLine })
    job.childKill = linkRun.kill
    r = await linkRun.promise
    if (!r.ok) return { ok: false, installed: gh, output: job.output, error: `注册 ${p.name} 到 profile 失败：${r.error || r.output.slice(-600)}` }
    names.push(p.name)
  }

  job.step = null
  return { ok: true, installed: names.join(', '), names, output: job.output }
}

/** Retry an `add` once without the byte-counting proxy (proxy may be the blocker). */
async function directRetry(job, args, onLine) {
  job.log.push('(本地字节统计代理不可用，改为直连重试…)')
  job.output += '(本地字节统计代理不可用，改为直连重试…)\n'
  if (job.proxy) { try { job.proxy.close() } catch { /* noop */ } job.proxy = null }
  const run = runDshAsync(args, { env: { ...process.env }, onLine })
  job.childKill = run.kill
  return await run.promise
}

async function executeJob(job) {
  try {
    if (job.canceled) {
      // canceled while queued — never run it
      finishJob(job, { ok: false, code: null, output: job.output, error: '安装已取消' })
      return
    }
    job.phase = 'resolving'
    job.percent = 8
    // Loopback byte-counting proxy (best-effort; never blocks the install).
    try { job.proxy = await createByteProxy() } catch { job.proxy = null }
    const proxyUrl = job.proxy ? job.proxy.url : null
    const env = proxyUrl
      ? { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, all_proxy: proxyUrl }
      : { ...process.env }
    estimateTotal(job).catch(() => {})
    const statTimer = setInterval(() => {
      if (!job.proxy) return
      const s = job.proxy.stats()
      job.bytesDown = s.bytesDown
      job.speedBps = s.speedBps
      if (s.expectedBytes > (job.bytesTotal || 0)) job.bytesTotal = s.expectedBytes
      updatePercent(job)
    }, 500)
    const timeoutTimer = setTimeout(() => {
      if (job.done) return
      job.timedOut = true
      job.error = '安装超时（超过 10 分钟），已终止'
      if (job.childKill) job.childKill()
    }, INSTALL_TIMEOUT_MS)
    const onLine = (line) => handleLine(job, line)
    const addStep = (args) => { const run = runDshAsync(args, { env, onLine }); job.childKill = run.kill; return run.promise }

    let r
    if (job.kind === 'update-workspace') {
      // marketplace-managed monorepo plugin: re-fetch + rebuild + re-link
      r = await installWorkspacePlugin(job, job.spec, env, onLine)
    } else if (job.kind === 'install') {
      const plan = await planInstall(job.spec)
      if (plan.type === 'workspace' && plan.gh) {
        // workspace root repo → install its real plugin sub-package(s)
        r = await installWorkspacePlugin(job, plan.gh, env, onLine)
      } else {
        job.depsBefore = Object.keys((profileManifest() && profileManifest().dependencies) || {})
        r = await addStep(['add', '-w', job.spec])
        if (!r.ok && job.proxy && !job.canceled && !job.timedOut) r = await directRetry(job, ['add', '-w', job.spec], onLine)
        if (r.ok) {
          // Verify the install actually produced a loadable plugin (in bundles
          // with a physical entry). A non-plugin root dependency would claim
          // success while loading nothing — the exact bug being fixed.
          const deps = (profileManifest() && profileManifest().dependencies) || {}
          const added = Object.keys(deps).filter((n) => !job.depsBefore.includes(n))
          const bad = added.filter((n) => !pluginLoadable(n))
          if (bad.length > 0) {
            // cleanup the useless plain dependency, then try the workspace path
            for (const n of bad) { try { await runDshSimple(['remove', n]) } catch { /* best effort */ } }
            if (plan.gh) {
              r = await installWorkspacePlugin(job, plan.gh, env, onLine)
            } else {
              r = { ok: false, installed: job.spec, output: job.output, error: `安装的包（${bad.join(', ')}）未声明 dsh.bundle，不是可加载的 DSH 插件，已回滚。` }
            }
          }
        }
      }
    } else {
      // kind === 'update'
      r = await addStep(['add', '-w', job.spec])
      if (!r.ok && job.proxy && !job.canceled && !job.timedOut) r = await directRetry(job, ['add', '-w', job.spec], onLine)
      if (r.ok && job.name && !pluginLoadable(job.name)) {
        r = { ok: false, installed: job.name, output: job.output, error: `更新后的 ${job.name} 未处于可加载状态（不在插件层或入口缺失），请重试。` }
      }
    }

    clearTimeout(timeoutTimer)
    clearInterval(statTimer)
    if (job.proxy) { try { job.proxy.close() } catch { /* noop */ } job.proxy = null }
    finishJob(job, r)
  } catch (e) {
    if (job.proxy) { try { job.proxy.close() } catch { /* noop */ } job.proxy = null }
    finishJob(job, { ok: false, code: null, output: job.output, error: String((e && e.message) || e) })
  }
}

/**
 * Clear, actionable error when the web profile isn't a usable install target,
 * or null when it is. `dsh plugin add -w` requires the profile to exist AND to
 * be a pnpm workspace root (pnpm-workspace.yaml); without the latter pnpm only
 * prints the cryptic "--workspace-root may only be used inside a workspace".
 */
function profileInstallError() {
  const dir = webProfileDir()
  if (!existsSync(join(dir, 'package.json'))) {
    return `web profile 不存在（${dir}）。请先启动过 dsh（会自动初始化 web profile），或运行 \`dsh plugin --profile web\` 初始化后再重试安装。`
  }
  if (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    return `web profile 缺少 pnpm-workspace.yaml，不是有效的 pnpm workspace，无法执行 \`dsh plugin add -w\`。`
      + `请在该目录创建 pnpm-workspace.yaml（参考内容：packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n），或重新初始化 profile 后重试。`
  }
  return null
}

/**
 * Validate and start an install. Returns `{ job }` or `{ error }`.
 */
function startInstall(spec) {
  const clean = String(spec || '').trim()
  if (!clean) return { error: 'empty spec' }
  // Reject cmd.exe and POSIX-shell metacharacters: the spec is untrusted
  // (model or browser input) and is concatenated into a shell command line.
  if (/[&|<>^()%"'!]/.test(clean)) return { error: 'spec contains shell metacharacters and was refused' }
  const profErr = profileInstallError()
  if (profErr) return { error: profErr }
  return { job: startJob('install', clean, null) }
}

/** Resolve and start an update for one installed plugin. Returns `{ job }` or `{ error }`. */
function startUpdate(name) {
  const manifest = profileManifest()
  if (!manifest) return { error: 'web profile manifest not found' }
  const profErr = profileInstallError()
  if (profErr) return { error: profErr }
  const deps = manifest.dependencies || {}
  const spec = deps[name]
  if (!spec) return { error: `${name} 不是后安装的插件，无法更新` }
  let target
  let kind = 'update'
  if (isLocalSpec(spec)) {
    // A marketplace-managed monorepo link points back into our source tree:
    // update by re-fetching the source repo, rebuilding and re-linking.
    const managed = managedSourceRepo(spec)
    if (managed) return { job: startJob('update-workspace', managed, name) }
    // Other local links have nothing to re-resolve; reinstall from the
    // package's declared GitHub repository when it has one (e.g. this marketplace).
    const repoGh = repositoryGitHubSpec(installedManifest(name))
    if (!repoGh) return { error: '本地链接插件没有可更新的 GitHub 仓库来源' }
    target = repoGh
  } else {
    const gh = githubSpec(spec)
    target = gh ? gh : `${name}@latest`
  }
  return { job: startJob(kind, target, name) }
}

/** Install a plugin spec and await the final result (model-tool path). */
async function installSpec(spec) {
  const r = startInstall(spec)
  if (r.error) return { ok: false, installed: String(spec || '').trim(), output: '', requiresRestart: false, error: r.error }
  return await r.job.result
}

/** Update one installed plugin and await the final result (model-tool path). */
async function updatePlugin(name) {
  const r = startUpdate(name)
  if (r.error) return { ok: false, name, output: '', requiresRestart: false, error: r.error }
  return await r.job.result
}

/** Remove an installed plugin from the web profile. */
async function uninstallPlugin(name) {
  const manifest = profileManifest()
  if (!manifest) return { ok: false, name, output: '', requiresRestart: false, error: 'web profile manifest not found' }
  const deps = manifest.dependencies || {}
  if (!(name in deps)) return { ok: false, name, output: '', requiresRestart: false, error: `${name} 不是后安装的插件；内置插件不能卸载` }
  const r = await runDshSimple(['remove', name])
  return { ok: r.ok, name, output: r.output, requiresRestart: true, error: r.error }
}

// Serialize manifest edits (disable/enable) so concurrent requests cannot
// clobber each other's read-modify-write.
let manifestLock = Promise.resolve()
function withManifestLock(task) {
  const run = manifestLock.then(task, task)
  manifestLock = run.catch(() => {})
  return run
}

/** Toggle an installed plugin's presence in the profile's active bundle list. */
async function setPluginEnabled(name, enabled) {
  return withManifestLock(async () => {
    const manifest = profileManifest()
    if (!manifest) return { ok: false, name, enabled: !!enabled, requiresRestart: false, error: 'web profile manifest not found' }
    const deps = manifest.dependencies || {}
    if (!(name in deps)) {
      return { ok: false, name, enabled: !!enabled, requiresRestart: false, error: `${name} 不是后安装的插件；内置插件不能关闭/卸载` }
    }
    const bundles = Array.isArray(manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles)
      ? manifest.dsh.profile.bundles
      : []
    const has = bundles.includes(name)
    const target = !!enabled
    if (target === has) return { ok: true, name, enabled: target, changed: false, requiresRestart: false, error: null }
    // Only promote actual plugins (packages declaring dsh.bundle/dsh.client)
    // into the loader's bundle layer list; a plain dependency cannot be a
    // bundle and would fail to boot.
    if (target) {
      const inst = installedManifest(name)
      const isPlugin = !!(inst && (inst.dsh?.bundle?.patch !== undefined || inst.dsh?.client !== undefined))
      if (!isPlugin) {
        return { ok: false, name, enabled: false, requiresRestart: false, error: `${name} 不是插件（未声明 dsh.bundle/dsh.client），无法启用` }
      }
      bundles.push(name)
    } else {
      bundles.splice(bundles.indexOf(name), 1)
    }
    manifest.dsh = { ...manifest.dsh, profile: { ...(manifest.dsh && manifest.dsh.profile), bundles } }
    writeProfileManifestFile(manifest)
    return { ok: true, name, enabled: target, changed: true, requiresRestart: true, error: null }
  })
}

/** Build the installed-plugin inventory with update availability. */
async function buildInstalledList() {
  const manifest = profileManifest()
  if (!manifest) return { plugins: [], self: null, error: 'web profile manifest not found' }
  const deps = manifest.dependencies || {}
  const bundles = Array.isArray(manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles
    : []
  const names = new Set([...Object.keys(deps), ...bundles])
  const plugins = []
  for (const name of names) {
    const isDep = Object.prototype.hasOwnProperty.call(deps, name)
    const isBundle = bundles.includes(name)
    const inst = installedManifest(name)
    const isPlugin = isBundle || !!(inst && (inst.dsh?.bundle?.patch !== undefined || inst.dsh?.client !== undefined))
    if (!isPlugin) continue // a plain dependency, not a plugin
    const kind = isDep ? 'installed' : 'builtin'
    const version = inst && typeof inst.version === 'string' ? inst.version : null
    const entry = {
      name,
      spec: isDep ? deps[name] : null,
      kind,
      enabled: isBundle,
      version,
      latestVersion: null,
      updateAvailable: false,
      description: inst && typeof inst.description === 'string' ? inst.description : null,
      homepage: inst
        ? (typeof inst.homepage === 'string'
          ? inst.homepage
          : (inst.repository && (typeof inst.repository === 'string' ? inst.repository : inst.repository.url) || null))
        : null,
    }
    if (kind === 'installed') {
      try {
        entry.latestVersion = await resolveLatest(name, deps[name], inst)
        entry.updateAvailable = versionGt(entry.latestVersion, version) === true
      } catch { /* keep entry without update info */ }
    }
    plugins.push(entry)
  }
  // The marketplace's own update status (its installed spec may be a link).
  const selfPkg = ownPackageJson()
  const selfName = String(selfPkg.name || 'dsh-plugin-marketplace')
  const selfSpec = Object.prototype.hasOwnProperty.call(deps, selfName) ? deps[selfName] : null
  let selfLatest = null
  try {
    const spec = selfSpec || repositoryGitHubSpec(selfPkg) || ''
    selfLatest = await resolveLatest(selfName, spec, selfPkg)
  } catch { /* ignore */ }
  const self = {
    name: selfName,
    version: String(selfPkg.version || ''),
    spec: selfSpec,
    latestVersion: selfLatest,
    updateAvailable: versionGt(selfLatest, selfPkg.version) === true,
  }
  // The installed-plugins surface only shows user-installed (third-party)
  // plugins; built-ins ship with the harness and are not manageable here.
  const installedOnly = plugins.filter((p) => p.kind === 'installed')
  installedOnly.sort((a, b) => (b.updateAvailable ? 1 : 0) - (a.updateAvailable ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
  return { plugins: installedOnly, self, error: null }
}

export default {
  inject: ['webServer', 'timer', 'tools'],
  apply(ctx) {
    const webServer = ctx.webServer
    const tools = ctx.tools

    // ── GitHub sync cache ────────────────────────────────────────────────
    // pageCache[key] = { items, total, fetchedAt }; key = `${q}|${page}|${perPage}`.
    const pageCache = new Map()
    let lastSync = 0

    async function fetchPage(q, page, perPage) {
      const params = new URLSearchParams({ q, per_page: String(perPage), page: String(page) })
      params.set('sort', 'stars')
      params.set('order', 'desc')
      const url = `${GITHUB_API}?${params.toString()}`
      const res = await fetch(url, {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-marketplace' },
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
      const data = await res.json()
      return {
        items: (Array.isArray(data.items) ? data.items : []).map((it) => ({
          fullName: String(it.full_name || ''),
          url: String(it.html_url || ''),
          description: String(it.description || ''),
          stars: typeof it.stargazers_count === 'number' ? it.stargazers_count : 0,
          language: String(it.language || ''),
          updatedAt: String(it.updated_at || ''),
          homepage: String(it.homepage || ''),
        })),
        total: typeof data.total_count === 'number' ? data.total_count : 0,
      }
    }

    async function ensurePage(q, page, perPage, force = false) {
      const key = `${q}|${page}|${perPage}`
      const cached = pageCache.get(key)
      const fresh = cached && Date.now() - cached.fetchedAt < REFRESH_MS
      if (!force && fresh) return cached
      const fetched = await fetchPage(q, page, perPage)
      const record = { ...fetched, fetchedAt: Date.now() }
      pageCache.set(key, record)
      if (!q) lastSync = Date.now()
      return record
    }

    // ── HTTP feed for the browser half ───────────────────────────────────
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const q = url.searchParams.get('q') || ''
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
        const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(url.searchParams.get('per_page')) || DEFAULT_PER_PAGE))
        const force = url.searchParams.get('force') === '1'
        const query = q ? `${TOPIC_QUERY} ${q}` : TOPIC_QUERY
        const record = await ensurePage(query, page, perPage, force)
        const hasMore = page * perPage < record.total
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({
          items: record.items,
          total: record.total,
          page,
          perPage,
          hasMore,
          q,
          fetchedAt: record.fetchedAt,
          error: null,
        }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ items: [], total: 0, page: 1, perPage: DEFAULT_PER_PAGE, hasMore: false, q: '', fetchedAt: lastSync, error: String((e && e.message) || e) }))
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/list', handler }))

    // ── small HTTP helpers ───────────────────────────────────────────────
    const json = (res, status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(data))
    }
    const readJsonBody = async (req) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      if (!raw) return {}
      try { return JSON.parse(raw) } catch { return {} }
    }
    const PLUGIN_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
    const validPluginName = (name) => typeof name === 'string' && PLUGIN_NAME_RE.test(name)

    // ── POST /api/market/install — start an async install job ────────────
    const installHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const spec = String((body && body.spec) || '').trim()
        const started = startInstall(spec)
        if (started.error) { json(res, 400, { ok: false, error: started.error }); return }
        json(res, 202, { ok: true, jobId: started.job.id })
      } catch (e) {
        json(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    }

    // ── GET /api/market/install/status?job=<id> — poll job progress ──────
    const installStatusHandler = async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const jobId = url.searchParams.get('job') || ''
        const job = JOBS.get(jobId)
        if (!job) { json(res, 404, { ok: false, error: 'job not found', done: true }); return }
        json(res, 200, { ok: true, job: snapshotOf(job) })
      } catch (e) {
        json(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    }

    // ── POST /api/market/install/cancel — abort a running job ────────────
    const installCancelHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const job = JOBS.get(String((body && body.jobId) || ''))
        if (!job) { json(res, 404, { ok: false, error: 'job not found' }); return }
        const result = await cancelJob(job)
        json(res, 200, { ok: true, ...result })
      } catch (e) {
        json(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/install', handler: installHandler }))
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/install/status', handler: installStatusHandler }))
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/install/cancel', handler: installCancelHandler }))

    // ── GET /api/market/installed — inventory + update availability ──────
    const installedHandler = async (req, res) => {
      try {
        const data = await buildInstalledList()
        json(res, 200, { ok: true, fetchedAt: Date.now(), plugins: data.plugins, self: data.self, error: data.error })
      } catch (e) {
        json(res, 500, { ok: false, plugins: [], self: null, error: String((e && e.message) || e) })
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/installed', handler: installedHandler }))

    // ── POST /api/market/update — start an async update job ──────────────
    const updateHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const name = String((body && body.name) || '').trim()
        if (!validPluginName(name)) { json(res, 400, { ok: false, error: 'invalid plugin name' }); return }
        const started = startUpdate(name)
        if (started.error) { json(res, 400, { ok: false, error: started.error }); return }
        json(res, 202, { ok: true, jobId: started.job.id })
      } catch (e) {
        json(res, 500, { ok: false, name: '', output: '', requiresRestart: false, error: String((e && e.message) || e) })
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/update', handler: updateHandler }))

    // ── POST /api/market/set-enabled — 关闭/启用 an installed plugin ─────
    const setEnabledHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const name = String((body && body.name) || '').trim()
        if (!validPluginName(name)) { json(res, 400, { ok: false, error: 'invalid plugin name' }); return }
        if (typeof (body && body.enabled) !== 'boolean') { json(res, 400, { ok: false, error: 'enabled must be a boolean' }); return }
        const result = await setPluginEnabled(name, body.enabled)
        json(res, result.ok ? 200 : 400, result)
      } catch (e) {
        json(res, 500, { ok: false, name: '', enabled: false, requiresRestart: false, error: String((e && e.message) || e) })
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/set-enabled', handler: setEnabledHandler }))

    // ── POST /api/market/uninstall — remove an installed plugin ──────────
    const uninstallHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const name = String((body && body.name) || '').trim()
        if (!validPluginName(name)) { json(res, 400, { ok: false, error: 'invalid plugin name' }); return }
        const result = await uninstallPlugin(name)
        json(res, result.ok ? 200 : 400, result)
      } catch (e) {
        json(res, 500, { ok: false, name: '', output: '', requiresRestart: false, error: String((e && e.message) || e) })
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/uninstall', handler: uninstallHandler }))

    // ── Model tool: market_search ────────────────────────────────────────
    const searchTool = {
      name: 'market_search',
      description: 'Search the DeepSeek Harness plugin marketplace (GitHub `dsh-plugin` topic) for installable plugins. Returns a JSON list of repositories: full name, stars, language, one-line description, and URL. Supports a keyword and pagination (the topic holds 1800+ repos, page through with `page`/`perPage`).',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search keyword within the dsh-plugin topic (name/description/language). Empty returns the top-starred page.' },
          page: { type: 'integer', description: 'Page number (1-based, default 1).' },
          perPage: { type: 'integer', description: 'Results per page (max 100, default 50).' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fullName: { type: 'string' },
                  url: { type: 'string' },
                  description: { type: 'string' },
                  stars: { type: 'integer' },
                  language: { type: 'string' },
                  updatedAt: { type: 'string' },
                  homepage: { type: 'string' },
                },
                additionalProperties: true,
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            perPage: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
          additionalProperties: true,
        },
        render(_args, value) {
          const v = value
          const lines = [`DSH 插件市场：共 ${v.total} 个仓库（第 ${v.page} 页 / 每页 ${v.perPage}${v.hasMore ? '，还有更多' : ''}）`]
          for (const it of v.items) {
            lines.push(`- ${it.fullName} (★${it.stars}${it.language ? ', ' + it.language : ''}) — ${it.description || '无简介'}`)
          }
          if (v.hasMore) lines.push('提示：用 page/perPage 翻页，或用 q 缩小范围。')
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const q = String((args && args.q) || '').trim()
        const page = Math.max(1, Number((args && args.page) || 1))
        const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number((args && args.perPage) || DEFAULT_PER_PAGE)))
        const query = q ? `${TOPIC_QUERY} ${q}` : TOPIC_QUERY
        const record = await ensurePage(query, page, perPage)
        return {
          items: record.items,
          total: record.total,
          page,
          perPage,
          hasMore: page * perPage < record.total,
        }
      },
    }

    // ── Model tool: market_install ───────────────────────────────────────
    const installTool = {
      name: 'market_install',
      description: 'Install a plugin from the DeepSeek Harness plugin marketplace into the current `web` profile. Accepts a package name (npm), a git repo (`owner/repo`), or a local path. Runs `dsh plugin --profile web add <spec>` and returns the output plus whether a harness restart is required. Prefer a package name or `owner/repo`; verify with market_search first.',
      parameters: {
        type: 'object',
        properties: {
          spec: { type: 'string', description: 'Package name, GitHub owner/repo, git URL, or local path to install.' },
        },
        required: ['spec'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            installed: { type: 'string' },
            output: { type: 'string' },
            requiresRestart: { type: 'boolean' },
            error: { type: 'string' },
          },
          additionalProperties: true,
        },
        render(_args, value) {
          const v = value
          if (v.ok) return [{ type: 'text', text: `已安装 ${v.installed}。${v.requiresRestart ? '需要重启 harness 后生效。' : ''}\n${v.output}` }]
          return [{ type: 'text', text: `安装失败：${v.error}\n${v.output || ''}` }]
        },
      },
      async execute(args) {
        const spec = String((args && args.spec) || '').trim()
        if (!spec) throw new Error('market_install requires a non-empty spec')
        return await installSpec(spec)
      },
    }

    // ── Model tool: market_installed ─────────────────────────────────────
    const installedTool = {
      name: 'market_installed',
      description: 'List the plugins installed in the current `web` profile with their versions and update availability. Returns `plugins` (each with `name`, `kind` = `builtin` or `installed`, `enabled`, `version`, `latestVersion`, `updateAvailable`) and `self` (this marketplace plugin\'s own update status). Use this before market_update to find names.',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          properties: {
            plugins: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  kind: { type: 'string' },
                  enabled: { type: 'boolean' },
                  version: { type: 'string' },
                  latestVersion: { type: 'string' },
                  updateAvailable: { type: 'boolean' },
                  description: { type: 'string' },
                },
                additionalProperties: true,
              },
            },
            self: { type: 'object', additionalProperties: true },
          },
          additionalProperties: true,
        },
        render(_args, value) {
          const v = value
          const lines = []
          if (v.self && v.self.updateAvailable) {
            lines.push(`插件市场可更新：v${v.self.version} → v${v.self.latestVersion}（用 market_update name=${v.self.name} 更新）`)
          }
          for (const p of v.plugins) {
            const enabled = p.enabled ? '启用' : '已关闭'
            const upd = p.updateAvailable ? ` · 可更新 v${p.latestVersion}` : ''
            lines.push(`- ${p.name} [${enabled}] v${p.version || '?'}${upd}`)
          }
          return [{ type: 'text', text: lines.join('\n') || '没有已安装的插件。' }]
        },
      },
      async execute() {
        const data = await buildInstalledList()
        return { plugins: data.plugins, self: data.self }
      },
    }

    // ── Model tool: market_update ────────────────────────────────────────
    const updateTool = {
      name: 'market_update',
      description: 'Update one installed plugin in the current `web` profile to its latest version (a harness restart is required to take effect). Accepts the package `name` exactly as reported by market_installed.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Package name of the installed plugin to update (from market_installed).' },
        },
        required: ['name'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            name: { type: 'string' },
            output: { type: 'string' },
            requiresRestart: { type: 'boolean' },
            error: { type: 'string' },
          },
          additionalProperties: true,
        },
        render(_args, value) {
          const v = value
          if (v.ok) return [{ type: 'text', text: `已更新 ${v.name}。${v.requiresRestart ? '需要重启 harness 后生效。' : ''}\n${v.output}` }]
          return [{ type: 'text', text: `更新失败：${v.error}\n${v.output || ''}` }]
        },
      },
      async execute(args) {
        const name = String((args && args.name) || '').trim()
        if (!validPluginName(name)) throw new Error('market_update requires a valid plugin name (from market_installed)')
        return await updatePlugin(name)
      },
    }

    ctx.effect(() => tools.register(searchTool))
    ctx.effect(() => tools.register(installTool))
    ctx.effect(() => tools.register(installedTool))
    ctx.effect(() => tools.register(updateTool))

    // ── periodic refresh of the base (page 1) cache ──────────────────────
    ctx.interval(() => {
      ensurePage(TOPIC_QUERY, 1, DEFAULT_PER_PAGE).catch(() => {})
    }, REFRESH_MS)
    ensurePage(TOPIC_QUERY, 1, DEFAULT_PER_PAGE).catch(() => {})
  },
}

// Internal API surface for standalone tests / tooling (harmless extra export;
// the loader consumes `export default`).
export const _market = {
  startInstall,
  startUpdate,
  installSpec,
  updatePlugin,
  cancelJob,
  snapshotOf,
  runDshSimple,
  fmtBytes,
  JOBS,
}
