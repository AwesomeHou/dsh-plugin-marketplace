/**
 * UI regression test for the 已安装 (installed) tab.
 *
 * Covers two reported UI defects:
 *  1. A disabled plugin must be labelled 已停用 (not 已关闭).
 *  2. While an action runs (更新 / 停用 / 启用 / 卸载) the row must keep exactly
 *     ONE button — the acted-on one, relabelled "更新中… / 停用中… / 启用中… /
 *     卸载中…" — and HIDE its siblings, instead of turning every sibling into a
 *     generic "处理中…" button.
 *
 * `lib/client.js` is a browser bundle: a plain script that hands a factory to
 * `window.__ModuleLoader__.load`. This test loads it in a `vm` sandbox with a
 * stub loader, a stub client ctx (capturing the tab components and the locale
 * dictionaries) and a ~30-line fake React that records `createElement` calls
 * and serves index-based `useState`. The captured 已安装 component is then
 * invoked directly with predetermined hook state, so the assertions run against
 * the REAL render code — no browser, no React dependency.
 *
 * Usage: node test/installed-tab-ui.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

// ── fake React ────────────────────────────────────────────────────────────
// Index-based hook store, reset for every render; createElement returns plain
// { type, props, children } nodes the walker below can inspect.
function makeFakeReact() {
  let store = []
  let index = 0
  return {
    hookState: (preset) => { store = preset.slice(); index = 0 },
    useState(initial) {
      const i = index++
      if (!(i in store)) store[i] = initial
      return [store[i], (v) => { store[i] = typeof v === 'function' ? v(store[i]) : v }]
    },
    useEffect() {},
    createElement(type, props) {
      const children = Array.from(arguments).slice(2).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      return { type, props: props || {}, children }
    },
  }
}

// ── fake module loader + client ctx ───────────────────────────────────────
const React = makeFakeReact()
const tabs = {}
const locales = {}
let lang = 'zh'
let loaded = null

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) {
        loaded = entry.factory((spec) => {
          if (spec === 'react') return React
          throw new Error('unexpected require: ' + spec)
        })
      },
    },
  },
  console,
}
vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })

if (!loaded || typeof loaded.apply !== 'function') {
  console.log('FAIL the client bundle did not export apply()')
  process.exit(1)
}

loaded.apply({
  effect: (fn) => fn(),
  locale: {
    register: (ns, dicts) => { locales[ns] = dicts; return () => {} },
    // Mirrors ctx.locale.bind(ns): resolve the key in the active language.
    bind: (ns) => (key) => {
      const dict = locales[ns] && locales[ns][lang]
      return dict && dict[key] !== undefined ? dict[key] : key
    },
  },
  slots: {
    inject: (_name, fn) => fn(),
    register: (config, Component) => { tabs[config.id] = Component; return () => {} },
  },
})

const Installed = tabs['installed']
if (typeof Installed !== 'function') {
  console.log('FAIL the installed tab was not registered: ' + Object.keys(tabs).join(', '))
  process.exit(1)
}

// ── render helpers ────────────────────────────────────────────────────────
/** Invoke the real component with preset hook state and return its element tree. */
function render(state, acts) {
  React.hookState([state, acts])
  return Installed()
}

function walk(node, visit) {
  if (node === null || typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) walk(child, visit)
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return (node.children || []).map(textOf).join('')
  return ''
}

/** { buttons: [label…], tags: [label…] } for the single card of one render. */
function row(tree) {
  const cards = []
  walk(tree, (n) => { if (n.props && n.props.className === 'dsh-market-card') cards.push(n) })
  if (cards.length !== 1) throw new Error('expected exactly 1 plugin card, got ' + cards.length)
  const buttons = []
  const tags = []
  walk(cards[0], (n) => {
    const cls = n.props && n.props.className
    if (n.type === 'button') buttons.push(textOf(n))
    // the plain tag is the "disabled" badge; tag-new / tag-self are separate
    if (cls === 'dsh-market-tag') tags.push(textOf(n))
  })
  return { buttons, tags, card: cards[0] }
}

const plugin = (over) => Object.assign({
  name: 'dsh-demo-plugin', kind: 'installed', enabled: true, version: '1.0.0',
  latestVersion: '2.0.0', updateAvailable: true, description: null, homepage: null,
}, over)
const emptyList = { loading: false, plugins: [], self: null, error: null, fetchedAt: 0 }

let failed = false
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' → ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (!ok) failed = true
}

const self = { name: 'dsh-plugin-marketplace' }
const listWith = (p) => ({ loading: false, plugins: [p], self, error: null, fetchedAt: 0 })

// ── 1) disabled plugin is labelled 已停用, never 已关闭 ───────────────────
check('zh disabledTag', locales['settings.marketplace'].zh.disabledTag, '已停用')
check('en disabledTag', locales['settings.marketplace'].en.disabledTag, 'Disabled')
{
  const r = row(render(listWith(plugin({ enabled: false, updateAvailable: false })), {}))
  check('idle disabled row buttons', r.buttons, ['启用', '卸载'])
  check('idle disabled row tags', r.tags, ['已停用'])
}
{
  const r = row(render(listWith(plugin({ enabled: true, updateAvailable: false })), {}))
  check('idle enabled row buttons', r.buttons, ['停用', '卸载'])
  check('idle enabled row tags', r.tags, [])
}

// ── 2) the label 处理中 must be gone from the dictionaries entirely ───────
for (const l of ['zh', 'en']) {
  const dict = locales['settings.marketplace'][l]
  check(l + ' has no "processing" key', 'processing' in dict, false)
  check(l + ' has disabling/enabling', [dict.disabling, dict.enabling], l === 'zh' ? ['停用中…', '启用中…'] : ['Disabling…', 'Enabling…'])
}
check('no 处理中 in any zh string', Object.values(locales['settings.marketplace'].zh).some((v) => String(v).includes('处理中')), false)

// ── 3) exactly one button — the acted-on one, relabelled — while busy ─────
const busy = (kind, extra) => Object.assign({ busy: true, kind, done: null, confirmUninstall: false, progress: null, jobId: null }, extra || {})

{
  const r = row(render(listWith(plugin({ updateAvailable: true })), { 'dsh-demo-plugin': busy('update') }))
  check('busy update → only 更新中…', r.buttons, ['更新中…'])
}
{
  const r = row(render(listWith(plugin({ enabled: true })), { 'dsh-demo-plugin': busy('set-enabled') }))
  check('busy disable → only 停用中…', r.buttons, ['停用中…'])
}
{
  const r = row(render(listWith(plugin({ enabled: false })), { 'dsh-demo-plugin': busy('set-enabled') }))
  check('busy enable → only 启用中…', r.buttons, ['启用中…'])
}
{
  const r = row(render(listWith(plugin({ updateAvailable: true })), { 'dsh-demo-plugin': busy('uninstall') }))
  check('busy uninstall → only 卸载中…', r.buttons, ['卸载中…'])
}
{
  // self row: the marketplace itself has no toggle/uninstall, only the update button
  const r = row(render({ loading: false, plugins: [plugin({ name: 'dsh-plugin-marketplace', updateAvailable: true })], self, error: null, fetchedAt: 0 }, { 'dsh-plugin-marketplace': busy('update') }))
  check('busy update on self → only 更新中…', r.buttons, ['更新中…'])
}

// ── 4) idle rows keep the full action set, ordered update/toggle/uninstall ─
{
  const r = row(render(listWith(plugin({ updateAvailable: true })), {}))
  check('idle updatable row buttons', r.buttons, ['更新到 v2.0.0', '停用', '卸载'])
}
// two-step uninstall confirmation only relabels the uninstall button; the
// siblings are still there (nothing is running yet, nothing gets hidden)
{
  const r = row(render(listWith(plugin({ updateAvailable: false })), { 'dsh-demo-plugin': { busy: false, kind: null, done: null, confirmUninstall: true } }))
  check('confirm-uninstall row buttons', r.buttons, ['停用', '确认卸载？'])
}

// ── 5) English locale renders the same single-button behaviour ────────────
lang = 'en'
{
  const r = row(render(listWith(plugin({ enabled: false, updateAvailable: true })), { 'dsh-demo-plugin': busy('uninstall') }))
  check('en busy uninstall → only Uninstalling…', r.buttons, ['Uninstalling…'])
  const idle = row(render(listWith(plugin({ enabled: false, updateAvailable: true })), {}))
  check('en idle disabled row', idle.buttons, ['Update to v2.0.0', 'Enable', 'Uninstall'])
  check('en idle disabled tag', idle.tags, ['Disabled'])
}
lang = 'zh'

// ── 6) an empty inventory renders no rows and no crash ────────────────────
{
  const tree = render(emptyList, {})
  let cards = 0
  walk(tree, (n) => { if (n.props && n.props.className === 'dsh-market-card') cards += 1 })
  check('empty inventory renders 0 cards', cards, 0)
}

if (failed) {
  console.log('FAIL installed tab UI')
  process.exit(1)
}
console.log('PASS installed tab UI (已停用 label + single relabelled in-flight button)')
process.exit(0)
