/**
 * dsh-plugin-marketplace — Client half (static bundle).
 *
 * A real browser script loaded through the client module system
 * (`window.__ModuleLoader__.load`), NOT a dynamic-plugin sandbox body: it
 * receives `require` (the module table) and runs with browser globals
 * (`fetch`, `document`) available. The module table's `react` seed supplies
 * React.
 *
 * It registers two tabs in the **Plugins settings section**
 * (`settings.plugins.tab`), so the marketplace sits beside the shipped
 * "插件配置" and "插件列表" tabs:
 * - `market` (插件市场) — the existing browse/search/install page, plus a
 *   self-update banner that appears when this marketplace has a newer version.
 * - `installed` (已安装) — manage what's installed: 更新 / 关闭 / 启用 / 卸载
 *   for user-installed plugins, and a read-only list of built-in plugins.
 *
 * The tabs fetch the Host feed at `/api/market/list` (paginated + searchable),
 * the inventory at `/api/market/installed`, and drive `/api/market/update`,
 * `/api/market/set-enabled` and `/api/market/uninstall`.
 *
 * Styling follows the shipped client-bundle pattern: a `<style>` element
 * tagged with this plugin's id.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-marketplace',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // CSS — injected once, tagged for the module system's style bookkeeping.
    var STYLE_TAG = 'dsh-plugin-marketplace/settings.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-marketplace'
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = [
        '.dsh-market { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }',
        '.dsh-market-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
        '.dsh-market-title { font-weight: 600; font-size: 15px; }',
        '.dsh-market-meta { font-size: 12px; opacity: 0.6; }',
        '.dsh-market-search { border: 1px solid rgba(128,128,128,0.4); background: transparent; color: inherit; border-radius: 8px; padding: 6px 12px; font-size: 13px; min-width: 200px; }',
        '.dsh-market-refresh, .dsh-market-more, .dsh-market-install, .dsh-market-act { cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; font-size: 12px; }',
        '.dsh-market-refresh:disabled, .dsh-market-more:disabled, .dsh-market-install:disabled, .dsh-market-act:disabled { opacity: 0.5; cursor: default; }',
        '.dsh-market-act[data-kind=update] { color: var(--dsw-alias-state-business-primary, #3b82f6); border-color: currentColor; }',
        '.dsh-market-act[data-kind=danger] { color: var(--dsw-alias-state-error-primary, #e5534b); border-color: currentColor; }',
        '.dsh-market-card { border: 1px solid rgba(128,128,128,0.3); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }',
        '.dsh-market-card + .dsh-market-card { margin-top: 8px; }',
        '.dsh-market-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
        '.dsh-market-card a { color: inherit; font-weight: 600; text-decoration: none; }',
        '.dsh-market-card a:hover { text-decoration: underline; }',
        '.dsh-market-namebox { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }',
        '.dsh-market-install[data-state=installing] { color: var(--dsw-alias-state-business-primary, #3b82f6); border-color: currentColor; }',
        '.dsh-market-install[data-state=installed] { color: var(--dsw-alias-state-success-primary, #16a34a); border-color: currentColor; }',
        '.dsh-market-install[data-state=error] { color: var(--dsw-alias-state-error-primary, #e5534b); border-color: currentColor; }',
        '.dsh-market-install-note { font-size: 11px; opacity: 0.7; }',
        '.dsh-market-desc { font-size: 12px; opacity: 0.8; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }',
        '.dsh-market-tags { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; }',
        '.dsh-market-tag { border: 1px solid rgba(128,128,128,0.4); border-radius: 999px; padding: 0 8px; }',
        '.dsh-market-tag-new { border: 1px solid var(--dsw-alias-state-business-primary, #3b82f6); color: var(--dsw-alias-state-business-primary, #3b82f6); border-radius: 999px; padding: 0 8px; font-size: 11px; }',
        '.dsh-market-tag-builtin { border: 1px solid rgba(128,128,128,0.4); color: var(--dsw-alias-label-tertiary, #9ca3af); border-radius: 999px; padding: 0 8px; font-size: 11px; }',
        '.dsh-market-tag-self { border: 1px solid var(--dsw-alias-state-success-primary, #16a34a); color: var(--dsw-alias-state-success-primary, #16a34a); border-radius: 999px; padding: 0 8px; font-size: 11px; }',
        '.dsh-market-version { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }',
        '.dsh-market-acts { display: flex; gap: 6px; flex-wrap: wrap; }',
        '.dsh-market-update-banner { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid rgba(59,130,246,0.6); background: rgba(59,130,246,0.08); border-radius: 8px; padding: 8px 12px; font-size: 12px; }',
        '.dsh-market-update-banner b { color: var(--dsw-alias-state-business-primary, #3b82f6); }',
        '.dsh-market-err { color: #e5534b; font-size: 12px; }',
        '.dsh-market-empty { font-size: 12px; opacity: 0.6; padding: 8px 0; }',
        '.dsh-market-out { font-size: 11px; opacity: 0.7; }',
        '.dsh-market-restart-note { font-size: 11px; opacity: 0.7; padding-top: 4px; }',
      ].join(' ')
      document.head.appendChild(tag)
    }

    var React = require('react')

    var PAGE_SIZE = 50

    // ── Self-update banner: shows when this marketplace has a newer version ──
    function SelfUpdateBanner() {
      var state = React.useState({ loading: true, self: null, updating: false, done: null })
      var set = state[1]
      var s = state[0]
      React.useEffect(function () {
        fetch('/api/market/installed', { cache: 'no-store' })
          .then(function (r) { return r.json() })
          .then(function (d) { set(function (x) { return Object.assign({}, x, { loading: false, self: (d && d.self) || null }) }) })
          .catch(function () { set(function (x) { return Object.assign({}, x, { loading: false, self: null }) }) })
      }, [])
      if (!s.self || !s.self.updateAvailable) return null
      var doUpdate = function () {
        set(function (x) { return Object.assign({}, x, { updating: true, done: null }) })
        fetch('/api/market/update', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: s.self.name }),
        })
          .then(function (r) { return r.json() })
          .then(function (d) { set(function (x) { return Object.assign({}, x, { updating: false, done: d }) }) })
          .catch(function () { set(function (x) { return Object.assign({}, x, { updating: false, done: { ok: false, error: '网络错误' } }) }) })
      }
      return React.createElement('div', { className: 'dsh-market-update-banner' },
        React.createElement('span', null, '插件市场有新版本：', React.createElement('b', null, 'v' + s.self.version + ' → v' + s.self.latestVersion), '。'),
        React.createElement('button', { className: 'dsh-market-act', 'data-kind': 'update', onClick: doUpdate, disabled: s.updating }, s.updating ? '更新中…' : '立即更新'),
        s.done
          ? React.createElement('span', { className: s.done.ok ? 'dsh-market-out' : 'dsh-market-err' },
            s.done.ok ? '已更新，重启 harness 后生效。' : ('更新失败：' + (s.done.error || '未知错误')))
          : null,
      )
    }

    // ── 插件市场 tab: browse / search / install ──────────────────────────
    function MarketTab() {
      var state = React.useState({ loading: false, items: [], total: 0, page: 0, hasMore: false, error: null, fetchedAt: 0 })
      var setState = state[1]
      var current = state[0]
      var query = React.useState('')
      var setQuery = query[1]
      var q = query[0]
      // installs: keyed by repo fullName → 'idle' | 'installing' | 'installed' | 'error'
      var installState = React.useState({})
      var setInstallState = installState[1]
      var installs = installState[0]

      var install = function install(it) {
        var key = it.fullName
        var spec = key // fullName is owner/repo — pnpm accepts it directly
        setInstallState(function (s) { return Object.assign({}, s, { [key]: 'installing' }) })
        fetch('/api/market/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spec: spec }),
        })
          .then(function (res) { return res.json() })
          .then(function (data) {
            setInstallState(function (s) { return Object.assign({}, s, { [key]: data.ok ? 'installed' : 'error' }) })
          })
          .catch(function () {
            setInstallState(function (s) { return Object.assign({}, s, { [key]: 'error' }) })
          })
      }

      var installLabel = function (key) {
        var s = installs[key]
        if (s === 'installing') return '安装中…'
        if (s === 'installed') return '已安装'
        if (s === 'error') return '安装失败'
        return '安装'
      }

      var loadPage = function loadPage(page, keyword, append) {
        setState(function (s) { return Object.assign({}, s, { loading: true }) })
        var params = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE) })
        if (keyword) params.set('q', keyword)
        fetch('/api/market/list?' + params.toString(), { cache: 'no-store' })
          .then(function (res) { return res.json() })
          .then(function (data) {
            setState(function (s) {
              return {
                loading: false,
                items: append ? s.items.concat(data.items || []) : (data.items || []),
                total: data.total || 0,
                page: data.page || page,
                hasMore: !!data.hasMore,
                error: data.error || null,
                fetchedAt: data.fetchedAt || 0,
              }
            })
          })
          .catch(function (e) {
            setState(function (s) { return Object.assign({}, s, { loading: false, error: String((e && e.message) || e) }) })
          })
      }

      // Initial load, and reload whenever the search keyword changes (debounced).
      React.useEffect(function () {
        loadPage(1, q.trim(), false)
      }, [q])

      var onSearch = function onSearch(e) { setQuery(e.target.value) }
      var onRefresh = function onRefresh() { loadPage(1, q.trim(), false) }
      var onMore = function onMore() { loadPage(current.page + 1, q.trim(), true) }

      var time = current.fetchedAt ? new Date(current.fetchedAt).toLocaleString() : '—'
      var shown = current.items.length

      return React.createElement('div', { className: 'dsh-market' },
        React.createElement(SelfUpdateBanner, null),
        React.createElement('div', { className: 'dsh-market-head' },
          React.createElement('span', { className: 'dsh-market-title' }, '插件市场'),
          React.createElement('span', { className: 'dsh-market-meta' }, '共 ' + current.total + ' 个 · 已显示 ' + shown + ' · 同步于 ' + time),
          React.createElement('input', {
            className: 'dsh-market-search',
            placeholder: '搜索插件名称 / 简介 / 语言…',
            value: q,
            onChange: onSearch,
          }),
          React.createElement('button', { className: 'dsh-market-refresh', onClick: onRefresh, disabled: current.loading }, current.loading ? '同步中…' : '刷新'),
        ),
        current.error ? React.createElement('div', { className: 'dsh-market-err' }, '同步失败: ' + current.error) : null,
        current.loading && current.items.length === 0
          ? React.createElement('div', { className: 'dsh-market-empty' }, '正在同步…')
          : (current.items.length === 0
            ? React.createElement('div', { className: 'dsh-market-empty' }, q.trim() ? '没有匹配的插件。' : '暂无插件数据。')
            : React.createElement('div', null,
              current.items.map(function (it) {
                var key = it.fullName
                var state = installs[key]
                var btn = React.createElement('button', {
                  className: 'dsh-market-install',
                  'data-state': state || 'idle',
                  onClick: function () { install(it) },
                  disabled: state === 'installing' || state === 'installed',
                }, installLabel(key))
                return React.createElement('div', { key: it.url + it.fullName, className: 'dsh-market-card' },
                  React.createElement('div', { className: 'dsh-market-card-head' },
                    React.createElement('a', { href: it.url, target: '_blank', rel: 'noreferrer' }, it.fullName),
                    btn,
                  ),
                  React.createElement('div', { className: 'dsh-market-desc' }, it.description),
                  React.createElement('div', { className: 'dsh-market-tags' },
                    React.createElement('span', { className: 'dsh-market-tag' }, '★ ' + it.stars),
                    it.language ? React.createElement('span', { className: 'dsh-market-tag' }, it.language) : null,
                  ),
                  state === 'installed'
                    ? React.createElement('div', { className: 'dsh-market-install-note' }, '已安装。重启 harness 后生效。')
                    : (state === 'error' ? React.createElement('div', { className: 'dsh-market-install-note' }, '安装失败，请稍后重试或使用 agent 的 market_install 查看详情。') : null),
                )
              }),
              current.hasMore
                ? React.createElement('div', { style: { padding: '8px 0', textAlign: 'center' } },
                  React.createElement('button', { className: 'dsh-market-more', onClick: onMore, disabled: current.loading }, current.loading ? '加载中…' : '加载更多'))
                : null,
            )),
      )
    }

    // ── 已安装 tab: update / disable / enable / uninstall ─────────────────
    function InstalledTab() {
      var state = React.useState({ loading: false, plugins: [], self: null, error: null, fetchedAt: 0 })
      var setState = state[1]
      var current = state[0]
      // acts: keyed by plugin name → { busy, done, confirmUninstall }
      var actState = React.useState({})
      var setAct = actState[1]
      var acts = actState[0]

      var load = function load() {
        setState(function (s) { return Object.assign({}, s, { loading: true }) })
        fetch('/api/market/installed', { cache: 'no-store' })
          .then(function (res) { return res.json() })
          .then(function (d) {
            setState({ loading: false, plugins: (d && d.plugins) || [], self: (d && d.self) || null, error: (d && d.error) || null, fetchedAt: Date.now() })
          })
          .catch(function (e) {
            setState(function (s) { return Object.assign({}, s, { loading: false, error: String((e && e.message) || e) }) })
          })
      }

      React.useEffect(function () { load() }, [])

      var run = function run(name, kind, payload) {
        setAct(function (s) { return Object.assign({}, s, { [name]: { busy: true, done: null, confirmUninstall: false } }) })
        fetch('/api/market/' + kind, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || { name: name }),
        })
          .then(function (res) { return res.json() })
          .then(function (d) {
            setAct(function (s) { return Object.assign({}, s, { [name]: { busy: false, done: d, confirmUninstall: false } }) })
            if (d && d.ok) load()
          })
          .catch(function () {
            setAct(function (s) { return Object.assign({}, s, { [name]: { busy: false, done: { ok: false, error: '网络错误' }, confirmUninstall: false } }) })
          })
      }

      var onUninstall = function onUninstall(name) {
        var a = acts[name] || {}
        if (!a.confirmUninstall) {
          setAct(function (s) { return Object.assign({}, s, { [name]: { busy: false, done: null, confirmUninstall: true } }) })
          return
        }
        run(name, 'uninstall')
      }

      var isSelf = function isSelf(p) { return current.self && p.name === current.self.name }
      var counts = { builtin: 0, installed: 0, updatable: 0 }
      current.plugins.forEach(function (p) {
        counts[p.kind === 'builtin' ? 'builtin' : 'installed'] += 1
        if (p.kind === 'installed' && p.updateAvailable) counts.updatable += 1
      })

      return React.createElement('div', { className: 'dsh-market' },
        React.createElement('div', { className: 'dsh-market-head' },
          React.createElement('span', { className: 'dsh-market-title' }, '已安装插件'),
          React.createElement('span', { className: 'dsh-market-meta' }, '内置 ' + counts.builtin + ' · 后安装 ' + counts.installed + (counts.updatable ? ' · ' + counts.updatable + ' 个可更新' : '')),
          React.createElement('button', { className: 'dsh-market-refresh', onClick: load, disabled: current.loading }, current.loading ? '读取中…' : '刷新'),
        ),
        React.createElement(SelfUpdateBanner, null),
        current.error ? React.createElement('div', { className: 'dsh-market-err' }, '读取失败: ' + current.error) : null,
        current.loading && current.plugins.length === 0
          ? React.createElement('div', { className: 'dsh-market-empty' }, '正在读取…')
          : (current.plugins.length === 0
            ? React.createElement('div', { className: 'dsh-market-empty' }, '还没有后安装的插件，去“插件市场”标签页安装吧。')
            : React.createElement('div', null,
              current.plugins.map(function (p) {
                var self = isSelf(p)
                var a = acts[p.name] || {}
                var busy = !!a.busy
                var done = a.done
                var actions = []
                if (p.kind === 'installed') {
                  if (p.updateAvailable) {
                    actions.push(React.createElement('button', {
                      key: 'update', className: 'dsh-market-act', 'data-kind': 'update',
                      onClick: function () { run(p.name, 'update') }, disabled: busy,
                    }, busy ? '更新中…' : '更新到 v' + p.latestVersion))
                  }
                  if (!self) {
                    actions.push(React.createElement('button', {
                      key: 'toggle', className: 'dsh-market-act', 'data-kind': p.enabled ? 'muted' : 'update',
                      onClick: function () { run(p.name, 'set-enabled', { name: p.name, enabled: !p.enabled }) }, disabled: busy,
                    }, busy ? '处理中…' : (p.enabled ? '关闭' : '启用')))
                    actions.push(React.createElement('button', {
                      key: 'uninstall', className: 'dsh-market-act', 'data-kind': 'danger',
                      onClick: function () { onUninstall(p.name) }, disabled: busy,
                    }, busy ? '卸载中…' : (a.confirmUninstall ? '确认卸载？' : '卸载')))
                  }
                }
                var note = done
                  ? (done.ok
                    ? React.createElement('div', { className: 'dsh-market-out' }, '已执行，重启 harness 后生效。')
                    : React.createElement('div', { className: 'dsh-market-err' }, '操作失败：' + (done.error || '未知错误')))
                  : null
                return React.createElement('div', { key: p.name, className: 'dsh-market-card' },
                  React.createElement('div', { className: 'dsh-market-card-head' },
                    React.createElement('div', { className: 'dsh-market-namebox' },
                      p.homepage
                        ? React.createElement('a', { href: p.homepage, target: '_blank', rel: 'noreferrer' }, p.name)
                        : React.createElement('strong', null, p.name),
                      p.kind === 'builtin'
                        ? React.createElement('span', { className: 'dsh-market-tag-builtin' }, '内置')
                        : React.createElement('span', { className: 'dsh-market-tag' }, '后安装'),
                      self ? React.createElement('span', { className: 'dsh-market-tag-self' }, '本插件') : null,
                      p.updateAvailable ? React.createElement('span', { className: 'dsh-market-tag-new' }, '可更新 v' + p.latestVersion) : null,
                      !p.enabled ? React.createElement('span', { className: 'dsh-market-tag' }, '已关闭') : null,
                    ),
                    actions.length > 0 ? React.createElement('div', { className: 'dsh-market-acts' }, actions) : null,
                  ),
                  React.createElement('div', { className: 'dsh-market-version' },
                    p.version ? ('v' + p.version) : '版本未知',
                    p.latestVersion ? (' · 最新 v' + p.latestVersion) : '',
                  ),
                  p.description ? React.createElement('div', { className: 'dsh-market-desc' }, p.description) : null,
                  p.kind === 'builtin'
                    ? React.createElement('div', { className: 'dsh-market-out' }, '内置插件随 harness 提供，不能关闭或卸载。')
                    : (self ? React.createElement('div', { className: 'dsh-market-out' }, '当前正在使用的插件，不能关闭或卸载。') : null),
                  note,
                )
              }),
              React.createElement('div', { className: 'dsh-market-restart-note' }, '关闭 / 启用 / 更新 / 卸载后需要重启 harness 才会生效。'),
            )),
      )
    }

    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register(
          { name: 'settings.plugins.tab', id: 'market', order: 5, label: function () { return '插件市场' } },
          MarketTab,
        )
      })
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register(
          { name: 'settings.plugins.tab', id: 'installed', order: 6, label: function () { return '已安装' } },
          InstalledTab,
        )
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
