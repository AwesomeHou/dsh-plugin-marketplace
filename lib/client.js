/**
 * dsh-plugin-marketplace — Client half (static bundle).
 *
 * This is a real browser script loaded through the client module system
 * (`window.__ModuleLoader__.load`), NOT a dynamic-plugin sandbox body: it
 * receives `require` (the module table) and runs with browser globals
 * (`fetch`, `document`) available. The module table's `react` seed supplies
 * React.
 *
 * It registers a `settings.section` page ("插件市场") that fetches
 * `/api/market/list` (served by this package's Host half) and renders a
 * searchable plugin list. Styling follows the shipped client-bundle pattern:
 * a `<style>` element tagged with this plugin's id.
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
        '.dsh-market-refresh { cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; font-size: 12px; }',
        '.dsh-market-refresh:disabled { opacity: 0.5; cursor: default; }',
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

    function MarketTab() {
      var state = React.useState({ loading: true, items: [], error: null, fetchedAt: 0 })
      var setState = state[1]
      var current = state[0]
      var q = React.useState('')[0]
      var setQ = React.useState('')[1]

      var load = function load(force) {
        setState(function (s) { return Object.assign({}, s, { loading: true }) })
        fetch('/api/market/list' + (force ? '?force=1' : ''), { cache: 'no-store' })
          .then(function (res) { return res.json() })
          .then(function (data) {
            setState({
              loading: false,
              items: Array.isArray(data.items) ? data.items : [],
              error: data.error || null,
              fetchedAt: data.fetchedAt || 0,
            })
          })
          .catch(function (e) {
            setState(function (s) { return Object.assign({}, s, { loading: false, error: String((e && e.message) || e) }) })
          })
      }

      React.useEffect(function () { load(false) }, [])

      var needle = q.trim().toLowerCase()
      var view = needle
        ? current.items.filter(function (it) {
          return it.fullName.toLowerCase().includes(needle) ||
            it.description.toLowerCase().includes(needle) ||
            it.language.toLowerCase().includes(needle)
        })
        : current.items

      var time = current.fetchedAt ? new Date(current.fetchedAt).toLocaleString() : '—'

      return React.createElement('div', { className: 'dsh-market' },
        React.createElement('div', { className: 'dsh-market-head' },
          React.createElement('span', { className: 'dsh-market-title' }, 'DSH 插件市场'),
          React.createElement('span', { className: 'dsh-market-meta' }, view.length + ' / ' + current.items.length + ' 个插件 · 同步于 ' + time),
          React.createElement('input', {
            className: 'dsh-market-search',
            placeholder: '搜索插件名称 / 简介 / 语言…',
            value: q,
            onChange: function (e) { setQ(e.target.value) },
          }),
          React.createElement('button', { className: 'dsh-market-refresh', onClick: function () { load(true) }, disabled: current.loading }, current.loading ? '同步中…' : '刷新'),
        ),
        current.error ? React.createElement('div', { className: 'dsh-market-err' }, '同步失败: ' + current.error) : null,
        current.loading && current.items.length === 0
          ? React.createElement('div', { className: 'dsh-market-empty' }, '正在同步…')
          : (view.length === 0
            ? React.createElement('div', { className: 'dsh-market-empty' }, needle ? '没有匹配的插件。' : '暂无插件数据。')
            : view.map(function (it) {
              return React.createElement('div', { key: it.url, className: 'dsh-market-card' },
                React.createElement('a', { href: it.url, target: '_blank', rel: 'noreferrer' }, it.fullName),
                React.createElement('div', { className: 'dsh-market-desc' }, it.description),
                React.createElement('div', { className: 'dsh-market-tags' },
                  React.createElement('span', { className: 'dsh-market-tag' }, '★ ' + it.stars),
                  it.language ? React.createElement('span', { className: 'dsh-market-tag' }, it.language) : null,
                ),
              )
            }))
      )
    }

    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'plugin-market', order: 18, label: function () { return '插件市场' } },
          MarketTab,
        )
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
