/**
 * dsh-plugin-marketplace — Client half (static bundle).
 *
 * A real browser script loaded through the client module system
 * (`window.__ModuleLoader__.load`), NOT a dynamic-plugin sandbox body: it
 * receives `require` (the module table) and runs with browser globals
 * (`fetch`, `document`) available. The module table's `react` seed supplies
 * React.
 *
 * It registers a tab in the **Plugins settings section**
 * (`settings.plugins.tab`, id `market`), so the marketplace sits beside the
 * shipped "插件配置" and "插件列表" tabs. The tab fetches the Host feed at
 * `/api/market/list` (paginated + searchable) and renders a search box, a
 * "加载更多" button, and a plugin card list.
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
        '.dsh-market-refresh, .dsh-market-more { cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; font-size: 12px; }',
        '.dsh-market-refresh:disabled, .dsh-market-more:disabled { opacity: 0.5; cursor: default; }',
        '.dsh-market-card { border: 1px solid rgba(128,128,128,0.3); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }',
        '.dsh-market-card a { color: inherit; font-weight: 600; text-decoration: none; }',
        '.dsh-market-card a:hover { text-decoration: underline; }',
        '.dsh-market-desc { font-size: 12px; opacity: 0.8; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }',
        '.dsh-market-tags { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; }',
        '.dsh-market-tag { border: 1px solid rgba(128,128,128,0.4); border-radius: 999px; padding: 0 8px; }',
        '.dsh-market-err { color: #e5534b; font-size: 12px; }',
        '.dsh-market-empty { font-size: 12px; opacity: 0.6; padding: 8px 0; }',
      ].join(' ')
      document.head.appendChild(tag)
    }

    var React = require('react')

    var PAGE_SIZE = 50

    function MarketTab() {
      var state = React.useState({ loading: false, items: [], total: 0, page: 0, hasMore: false, error: null, fetchedAt: 0 })
      var setState = state[1]
      var current = state[0]
      var query = React.useState('')
      var setQuery = query[1]
      var q = query[0]

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
                return React.createElement('div', { key: it.url + it.fullName, className: 'dsh-market-card' },
                  React.createElement('a', { href: it.url, target: '_blank', rel: 'noreferrer' }, it.fullName),
                  React.createElement('div', { className: 'dsh-market-desc' }, it.description),
                  React.createElement('div', { className: 'dsh-market-tags' },
                    React.createElement('span', { className: 'dsh-market-tag' }, '★ ' + it.stars),
                    it.language ? React.createElement('span', { className: 'dsh-market-tag' }, it.language) : null,
                  ),
                )
              }),
              current.hasMore
                ? React.createElement('div', { style: { padding: '8px 0', textAlign: 'center' } },
                  React.createElement('button', { className: 'dsh-market-more', onClick: onMore, disabled: current.loading }, current.loading ? '加载中…' : '加载更多'))
                : null,
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
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
