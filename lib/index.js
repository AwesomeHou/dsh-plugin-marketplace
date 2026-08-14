/**
 * dsh-plugin-marketplace — Host half.
 *
 * A permanent (bundle) plugin that syncs the GitHub `dsh-plugin` topic into a
 * cached JSON feed and exposes model tools, so both the settings UI and the
 * agent itself can discover and install plugins.
 *
 * Data:
 * - GitHub Search API `q=topic:dsh-plugin` is paginated (`per_page` max 100).
 *   The full topic holds 1800+ repos; we cache pages on demand so the UI can
 *   "load more" and search can narrow the whole set via GitHub's own `q`.
 * - Served over `ctx.webServer` at `GET /api/market/list`:
 *   `?q=<kw>&page=<n>&per_page=<n>` → `{ items, total, page, perPage, hasMore,
 *   fetchedAt, error }`.
 *
 * Model tools (registered via `ctx.tools.register`):
 * - `market_search` — search the topic (keyword + pagination), JSON list.
 * - `market_install` — install a plugin into the web profile via
 *   `dsh plugin --profile web add <spec>` (spawned through `node:child_process`).
 *
 * Unlike a dynamic plugin there is no `harness`/`host.call` sandbox here; this
 * is a plain Node module with full access to Node built-ins and the web app's
 * own HTTP server.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TOPIC_QUERY = 'topic:dsh-plugin'
const GITHUB_API = 'https://api.github.com/search/repositories'
const REFRESH_MS = 10 * 60 * 1000
const DEFAULT_PER_PAGE = 50
const MAX_PER_PAGE = 100

/** Resolve the active web profile directory (honors DSH_HOME, else ~/.dsh). */
function webProfileDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
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
        // Reject cmd.exe and POSIX-shell metacharacters: the spec is model
        // input and is concatenated into a shell command line, so it must not
        // escape. Single and double quotes are both refused so the same guard
        // is safe under cmd.exe (double-quote quoting) and POSIX (single-quote
        // quoting) alike.
        if (/[&|<>^()%"'!]/.test(spec)) {
          return { ok: false, installed: spec, output: '', requiresRestart: false, error: 'spec contains shell metacharacters and was refused' }
        }
        const profileDir = webProfileDir()
        if (!existsSync(join(profileDir, 'package.json'))) {
          return { ok: false, installed: '', output: '', requiresRestart: false, error: `web profile not found at ${profileDir}` }
        }
        // On Windows run through cmd with the spec single-quoted for cmd
        // (double-quote escaping is unreliable here); on POSIX let the shell
        // quote it. Either way no metacharacters survive the guard above.
        const command = process.platform === 'win32'
          ? `dsh plugin --profile web add '${spec}'`
          : `dsh plugin --profile web add "${spec}"`
        const result = spawnSync(command, [], {
          cwd: process.cwd(),
          shell: true,
          encoding: 'utf8',
          timeout: 120000,
        })
        const output = (result.stdout || '') + (result.stderr || '')
        const ok = result.status === 0
        return {
          ok,
          installed: spec,
          output: output.trim(),
          requiresRestart: true,
          error: ok ? null : (result.error ? result.error.message : `exit ${result.status}`),
        }
      },
    }

    ctx.effect(() => tools.register(searchTool))
    ctx.effect(() => tools.register(installTool))

    // ── periodic refresh of the base (page 1) cache ──────────────────────
    ctx.interval(() => {
      ensurePage(TOPIC_QUERY, 1, DEFAULT_PER_PAGE).catch(() => {})
    }, REFRESH_MS)
    ensurePage(TOPIC_QUERY, 1, DEFAULT_PER_PAGE).catch(() => {})
  },
}
