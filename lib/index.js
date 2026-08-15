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
 * - `POST /api/market/install` with `{ spec }` → one-click install result
 *   `{ ok, installed, output, requiresRestart, error }`.
 * - `GET /api/market/installed` → the web profile's plugin inventory
 *   `{ plugins, self, fetchedAt }`. Each plugin carries `kind`
 *   (`builtin` = ships with the profile template, `installed` = added later),
 *   `enabled`, `version`, `latestVersion` and `updateAvailable`.
 * - `POST /api/market/update` `{ name }` → update one installed plugin.
 * - `POST /api/market/set-enabled` `{ name, enabled }` → 关闭/启用 an installed
 *   plugin (toggles it in/out of the profile's active bundle layer list).
 * - `POST /api/market/uninstall` `{ name }` → remove an installed plugin.
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
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** Run one `dsh plugin --profile web …` invocation and capture its output. */
async function runDsh(args) {
  const profileDir = webProfileDir()
  if (!existsSync(join(profileDir, 'package.json'))) {
    return { ok: false, output: '', error: `web profile not found at ${profileDir}` }
  }
  // Reject cmd.exe and POSIX-shell metacharacters: everything here ends up
  // concatenated into a shell command line, so single and double quotes are
  // both refused (same guard as installSpec).
  const bad = args.find((a) => typeof a !== 'string' || /[&|<>^()%"'!]/.test(a))
  if (bad !== undefined) return { ok: false, output: '', error: 'argument contains shell metacharacters and was refused' }
  const command = `dsh plugin --profile web ${args.map((a) => `"${a}"`).join(' ')}`
  const result = spawnSync(command, [], {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    timeout: 120000,
  })
  const output = ((result.stdout || '') + (result.stderr || '')).trim()
  const ok = result.status === 0
  return { ok, output, error: ok ? null : (result.error ? result.error.message : `exit ${result.status}`) }
}

/**
 * Install a plugin spec into the web profile.
 * @param {string} spec - package name, owner/repo, git URL, or local path.
 * @returns {Promise<{ok: boolean, installed: string, output: string, requiresRestart: boolean, error: string|null}>}
 */
async function installSpec(spec) {
  const clean = String(spec || '').trim()
  if (!clean) return { ok: false, installed: '', output: '', requiresRestart: false, error: 'empty spec' }
  // Reject cmd.exe and POSIX-shell metacharacters: the spec is untrusted
  // (model or browser input) and is concatenated into a shell command line.
  // Single and double quotes are both refused so the same guard is safe under
  // cmd.exe and POSIX alike.
  if (/[&|<>^()%"'!]/.test(clean)) {
    return { ok: false, installed: clean, output: '', requiresRestart: false, error: 'spec contains shell metacharacters and was refused' }
  }
  const r = await runDsh(['add', '-w', clean])
  return { ok: r.ok, installed: clean, output: r.output, requiresRestart: true, error: r.error }
}

/** Update one installed plugin to its latest version. */
async function updatePlugin(name) {
  const manifest = profileManifest()
  if (!manifest) return { ok: false, name, output: '', requiresRestart: false, error: 'web profile manifest not found' }
  const deps = manifest.dependencies || {}
  const spec = deps[name]
  if (!spec) return { ok: false, name, output: '', requiresRestart: false, error: `${name} 不是后安装的插件，无法更新` }
  if (isLocalSpec(spec)) {
    // A local link has nothing to re-resolve; reinstall from the package's
    // declared GitHub repository when it has one (e.g. this marketplace).
    const repoGh = repositoryGitHubSpec(installedManifest(name))
    if (!repoGh) return { ok: false, name, output: '', requiresRestart: false, error: '本地链接插件没有可更新的 GitHub 仓库来源' }
    const r = await runDsh(['add', '-w', repoGh])
    return { ok: r.ok, name, output: r.output, requiresRestart: true, error: r.error }
  }
  const gh = githubSpec(spec)
  const args = gh ? ['add', '-w', gh] : ['add', '-w', `${name}@latest`]
  const r = await runDsh(args)
  return { ok: r.ok, name, output: r.output, requiresRestart: true, error: r.error }
}

/** Remove an installed plugin from the web profile. */
async function uninstallPlugin(name) {
  const manifest = profileManifest()
  if (!manifest) return { ok: false, name, output: '', requiresRestart: false, error: 'web profile manifest not found' }
  const deps = manifest.dependencies || {}
  if (!(name in deps)) return { ok: false, name, output: '', requiresRestart: false, error: `${name} 不是后安装的插件；内置插件不能卸载` }
  const r = await runDsh(['remove', name])
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

    // ── POST /api/market/install — one-click install for the browser UI ──
    const installHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const spec = String((body && body.spec) || '').trim()
        const result = await installSpec(spec)
        json(res, result.ok ? 200 : 400, result)
      } catch (e) {
        json(res, 500, { ok: false, installed: '', output: '', requiresRestart: false, error: String((e && e.message) || e) })
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/install', handler: installHandler }))

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

    // ── POST /api/market/update — update an installed plugin ─────────────
    const updateHandler = async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        const name = String((body && body.name) || '').trim()
        if (!validPluginName(name)) { json(res, 400, { ok: false, error: 'invalid plugin name' }); return }
        const result = await updatePlugin(name)
        json(res, result.ok ? 200 : 400, result)
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
        q: { type: 'string', required: false, description: 'Search keyword within the dsh-plugin topic (name/description/language). Empty returns the top-starred page.' },
        page: { type: 'integer', required: false, description: 'Page number (1-based, default 1).' },
        perPage: { type: 'integer', required: false, description: 'Results per page (max 100, default 50).' },
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
        spec: { type: 'string', required: true, description: 'Package name, GitHub owner/repo, git URL, or local path to install.' },
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
      parameters: {},
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
        name: { type: 'string', required: true, description: 'Package name of the installed plugin to update (from market_installed).' },
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
