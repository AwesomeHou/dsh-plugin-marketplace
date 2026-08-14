/**
 * dsh-plugin-marketplace — Host half.
 *
 * A permanent (bundle) plugin that syncs the GitHub `dsh-plugin` topic into a
 * cached JSON feed served over the web app's own HTTP server. The browser
 * half fetches this feed; there is no dynamic-plugin RPC here.
 *
 * - Sync: global `fetch` to the GitHub Search API (`topic:dsh-plugin`),
 *   cached in memory, refreshed on an interval and on demand.
 * - Serve: one exact route `/api/market/list` on `ctx.webServer`, returning
 *   `{ items, total, fetchedAt, error }` (and applying an optional `?q=`
 *   filter). Plain JSON only.
 */
export default {
  inject: ['webServer', 'timer'],
  apply(ctx) {
    const webServer = ctx.webServer
    const REFRESH_MS = 10 * 60 * 1000
    const API_URL = 'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=50'

    let items = []
    let fetchedAt = 0
    let error = null
    let inflight = null

    async function syncOnce() {
      const res = await fetch(API_URL, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'dsh-plugin-marketplace',
        },
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
      const data = await res.json()
      const next = (Array.isArray(data.items) ? data.items : []).map((it) => ({
        fullName: String(it.full_name || ''),
        url: String(it.html_url || ''),
        description: String(it.description || ''),
        stars: typeof it.stargazers_count === 'number' ? it.stargazers_count : 0,
        language: String(it.language || ''),
        updatedAt: String(it.updated_at || ''),
      }))
      items = next
      fetchedAt = Date.now()
      error = null
    }

    function sync(force = false) {
      if (inflight) return inflight
      if (!force && items.length && Date.now() - fetchedAt < REFRESH_MS) return Promise.resolve()
      inflight = syncOnce().catch((e) => {
        error = String((e && e.message) || e)
      }).finally(() => {
        inflight = null
      })
      return inflight
    }

    function filterByQuery(list, q) {
      const needle = String(q || '').trim().toLowerCase()
      if (!needle) return list
      return list.filter((it) =>
        it.fullName.toLowerCase().includes(needle) ||
        it.description.toLowerCase().includes(needle) ||
        it.language.toLowerCase().includes(needle),
      )
    }

    const handler = async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const q = url.searchParams.get('q') || ''
        await sync(false)
        const view = filterByQuery(items, q)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ items: view, total: items.length, q, fetchedAt, error }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ items: [], total: 0, q: '', fetchedAt, error: String((e && e.message) || e) }))
      }
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/market/list', handler }))
    ctx.interval(() => sync(false).catch(() => {}), REFRESH_MS)
    sync(false).catch(() => {})
  },
}
