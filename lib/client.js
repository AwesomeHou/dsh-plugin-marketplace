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
 * (`settings.plugins.tab`), beside the shipped tabs.
 *
 * UI copy lives in the MARKET_LOCALES dictionary below (zh + en) and is
 * resolved through ctx.locale — this file is the single shipped client
 * artifact; locales are kept here (not split out) so git installs need no
 * build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-marketplace',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
var MARKET_LOCALES = {
  "zh": {
    "preparing": "准备中…",
    "resolving": "正在解析依赖…",
    "downloading": "正在下载…",
    "installing": "正在安装…",
    "done": "已完成",
    "failed": "失败",
    "canceled": "已取消",
    "taskExpired": "任务不存在或已过期",
    "sendToAgentFailed": "发送给 agent 失败",
    "noSession": "当前没有可用的会话",
    "downloaded": "已下载 ",
    "about": "共约 ",
    "eta": "剩余约 ",
    "etaSuffix": "",
    "depsPrefix": "依赖：",
    "depsReused": " 个（复用 ",
    "depsDownload": "，下载 ",
    "depsAdded": "，添加 ",
    "closeParen": "）",
    "cancel": "取消",
    "networkError": "网络错误",
    "updateAvailable": "插件市场有新版本：",
    "period": "。",
    "updating": "更新中…",
    "updateNow": "立即更新",
    "updatedRestart": "已更新，重启 harness 后生效。",
    "updateFailed": "更新失败：",
    "unknownError": "未知错误",
    "translating": "翻译中…",
    "translationFailed": "翻译失败：",
    "original": "原文：",
    "noTranslation": "暂无翻译内容。",
    "descriptionTranslate": "简介翻译",
    "installFailed": "安装失败",
    "agentIntro1": "请在插件市场安装插件 ",
    "agentIntro2": "。请按以下步骤处理：\\n",
    "agentStep1a": "1. 先查看该仓库的 README（README.md 或 README.zh.md，可通过 https://raw.githubusercontent.com/",
    "agentStep1b": "/HEAD/README.md 获取），",
    "agentStep1c": "确认里面是否说明了如何安装这个插件（例如提供了 scripts/install.sh、link: 注册、或需要先构建等）。若 README 明确写了安装方式，请遵循它。\\n",
    "agentStep2a": "2. 再分析它是不是可用的 DSH 插件：查看根 package.json 是否声明了 dsh.bundle / dsh.client；若没有，它可能是 monorepo/workspace 根，",
    "agentStep2b": "真正的插件在子包中——请定位到声明了 dsh.bundle / dsh.client 的那个包。\\n",
    "agentStep3a": "3. 用合适的方式把它安装到 web profile（可参考 market_install 工具或 dsh plugin 命令；如需构建请先构建）。",
    "agentStep3b": "安装后验证结果：确认插件已进入 dsh.profile.bundles 且入口文件存在；若插件提供运行时端点（如 /ext/bridge-config）可顺带检查。\\n",
    "agentStep4": "4. 最后在对话中汇报你的分析与安装结果；如需重启 harness 才能生效，请明确说明。\\n",
    "agentStep5": "5. 若安装失败，请明确给出失败原因和解决办法（例如 web profile 缺少 pnpm-workspace.yaml、没有有效的工作目录、构建失败等），不要静默失败或只笼统地说\"安装失败\"。",
    "wsPathFailed": "无法获取专属安装工作区路径",
    "wsRegisterFailed": "无法注册专属安装工作区",
    "sending": "发送中…",
    "handedOff": "已交给 agent",
    "installingShort": "安装中…",
    "installed": "已安装",
    "retry": "重试",
    "install": "安装",
    "translateFailed": "翻译失败",
    "marketTitle": "插件市场",
    "totalPrefix": "共 ",
    "showingSuffix": " 个 · 已显示 ",
    "syncedAt": " · 同步于 ",
    "searchPlaceholder": "搜索插件名称 / 简介 / 语言…",
    "syncing": "同步中…",
    "refresh": "刷新",
    "sourceLabel": "插件来源：",
    "topicLabel": "GitHub dsh-plugin 话题",
    "sourceNote": "（github.com/topics/dsh-plugin），通过 GitHub Search API 实时同步。安装来源以卡片给出的仓库为准。",
    "syncFailed": "同步失败: ",
    "syncingAlt": "正在同步…",
    "noMatch": "没有匹配的插件。",
    "noPluginData": "暂无插件数据。",
    "translate": "翻译",
    "sendingToAgent": "正在发送给 agent…",
    "handedOffDetail": "已交给 agent 处理：已在专属工作区新开对话，请到该对话查看安装过程与结果。",
    "installedRestart": "已安装。重启 harness 后生效。",
    "directInstallFailed": "直装失败：",
    "directInstallAdvice": "可点击「重试」；若仓库结构特殊（需按 README 构建/脚本安装），可改用 agent 安装。",
    "sentenceSep": "。 ",
    "installViaAgent": "让 agent 安装",
    "loading": "加载中…",
    "loadMore": "加载更多",
    "translatePrefix": "翻译 · ",
    "operationFailed": "操作失败",
    "installedTitle": "已安装插件",
    "countSuffix": " 个",
    "updatableSuffix": " 个可更新",
    "reading": "读取中…",
    "thirdPartyNote": "本页显示的是已安装的第三方插件；内置插件随 harness 提供，不在此列出。",
    "readFailed": "读取失败: ",
    "readingAlt": "正在读取…",
    "noThirdParty": "还没有安装第三方插件，去「插件市场」标签页安装吧。",
    "updateTo": "更新到 v",
    "processing": "处理中…",
    "disable": "停用",
    "enable": "启用",
    "uninstalling": "卸载中…",
    "confirmUninstall": "确认卸载？",
    "uninstall": "卸载",
    "executedRestart": "已执行，重启 harness 后生效。",
    "operationFailedColon": "操作失败：",
    "thisPlugin": "本插件",
    "updateAvailableV": "可更新 v",
    "disabledTag": "已关闭",
    "unknownVersion": "版本未知",
    "latestV": " · 最新 v",
    "selfNote": "当前正在使用的插件，不能关闭或卸载。",
    "restartNote": "关闭 / 启用 / 更新 / 卸载后需要重启 harness 才会生效。"
  },
  "en": {
    "preparing": "Preparing…",
    "resolving": "Resolving dependencies…",
    "downloading": "Downloading…",
    "installing": "Installing…",
    "done": "Done",
    "failed": "Failed",
    "canceled": "Canceled",
    "taskExpired": "Task not found or expired",
    "sendToAgentFailed": "Failed to send to agent",
    "noSession": "No session available",
    "downloaded": "Downloaded ",
    "about": "Total ~ ",
    "eta": "~ ",
    "etaSuffix": " left",
    "depsPrefix": "Dependencies: ",
    "depsReused": " (reused ",
    "depsDownload": ", downloaded ",
    "depsAdded": ", added ",
    "closeParen": ")",
    "cancel": "Cancel",
    "networkError": "Network error",
    "updateAvailable": "A new marketplace version is available: ",
    "period": ".",
    "updating": "Updating…",
    "updateNow": "Update now",
    "updatedRestart": "Updated. Restart the harness to take effect.",
    "updateFailed": "Update failed: ",
    "unknownError": "Unknown error",
    "translating": "Translating…",
    "translationFailed": "Translation failed: ",
    "original": "Original: ",
    "noTranslation": "No translation available.",
    "descriptionTranslate": "Description Translation",
    "installFailed": "Installation failed",
    "agentIntro1": "Install the plugin from the marketplace ",
    "agentIntro2": " and handle it as follows:\n",
    "agentStep1a": "1. First read the repo README (README.md or README.zh.md, via https://raw.githubusercontent.com/",
    "agentStep1b": "/HEAD/README.md)",
    "agentStep1c": " and check whether it explains how to install this plugin (e.g. a scripts/install.sh, link: registration, or a build step). If the README specifies a method, follow it.\n",
    "agentStep2a": "2. Then verify it’s a usable DSH plugin: check the root package.json for dsh.bundle / dsh.client. If absent, it’s likely a monorepo/workspace root —",
    "agentStep2b": " locate the package that declares dsh.bundle / dsh.client.\n",
    "agentStep3a": "3. Install it into the web profile using the appropriate method (see the market_install tool or the dsh plugin command; build first if needed).",
    "agentStep3b": " After installing, verify the plugin is in dsh.profile.bundles and its entry file exists; if it exposes a runtime endpoint (e.g. /ext/bridge-config), check it too.\n",
    "agentStep4": "4. Finally, report your analysis and the installation result in the conversation; clearly state if a harness restart is required.\n",
    "agentStep5": "5. If installation fails, provide the specific reason and solution (e.g. the web profile is missing pnpm-workspace.yaml, no valid working directory, a build failure); do not fail silently or just say “Installation failed”.",
    "wsPathFailed": "Unable to resolve the dedicated install workspace path",
    "wsRegisterFailed": "Unable to register the dedicated install workspace",
    "sending": "Sending…",
    "handedOff": "Handed off to agent",
    "installingShort": "Installing…",
    "installed": "Installed",
    "retry": "Retry",
    "install": "Install",
    "translateFailed": "Translation failed",
    "marketTitle": "Plugin Marketplace",
    "totalPrefix": "Total ",
    "showingSuffix": " plugins · showing ",
    "syncedAt": " · synced at ",
    "searchPlaceholder": "Search by plugin name, description, or language…",
    "syncing": "Syncing…",
    "refresh": "Refresh",
    "sourceLabel": "Source: ",
    "topicLabel": "GitHub dsh-plugin topic",
    "sourceNote": "(github.com/topics/dsh-plugin), synced live via the GitHub Search API. The installation source matches the repository shown on each card.",
    "syncFailed": "Sync failed: ",
    "syncingAlt": "Syncing…",
    "noMatch": "No matching plugins.",
    "noPluginData": "No plugin data yet.",
    "translate": "Translate",
    "sendingToAgent": "Sending to agent…",
    "handedOffDetail": "Handed off to the agent: a new conversation has been opened in the dedicated workspace — please check it for the installation progress and result.",
    "installedRestart": "Installed. Restart the harness to take effect.",
    "directInstallFailed": "Direct install failed: ",
    "directInstallAdvice": "Click Retry, or if the repo requires a specific build/script installation (see README), use “Install via agent”.",
    "sentenceSep": ". ",
    "installViaAgent": "Install via agent",
    "loading": "Loading…",
    "loadMore": "Load more",
    "translatePrefix": "Translate · ",
    "operationFailed": "Operation failed",
    "installedTitle": "Installed plugins",
    "countSuffix": " plugins",
    "updatableSuffix": " updates available",
    "reading": "Reading…",
    "thirdPartyNote": "Showing third-party plugins only; built-in plugins ship with the harness and are not listed here.",
    "readFailed": "Read failed: ",
    "readingAlt": "Loading…",
    "noThirdParty": "No third-party plugins installed yet — go to the Market tab to install some.",
    "updateTo": "Update to v",
    "processing": "Processing…",
    "disable": "Disable",
    "enable": "Enable",
    "uninstalling": "Uninstalling…",
    "confirmUninstall": "Uninstall?",
    "uninstall": "Uninstall",
    "executedRestart": "Done. Restart the harness to take effect.",
    "operationFailedColon": "Operation failed: ",
    "thisPlugin": "This plugin",
    "updateAvailableV": "Update available: v",
    "disabledTag": "Disabled",
    "unknownVersion": "Unknown version",
    "latestV": " · latest v",
    "selfNote": "This is the active plugin; it cannot be disabled or uninstalled.",
    "restartNote": "Changes (disable / enable / update / uninstall) take effect after restarting the harness."
  }
}


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
        '.dsh-market-refresh, .dsh-market-more, .dsh-market-install, .dsh-market-act, .dsh-market-tr { cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; font-size: 12px; }',
        '.dsh-market-refresh:disabled, .dsh-market-more:disabled, .dsh-market-install:disabled, .dsh-market-act:disabled, .dsh-market-tr:disabled { opacity: 0.5; cursor: default; }',
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
        '.dsh-market-tag-self { border: 1px solid var(--dsw-alias-state-success-primary, #16a34a); color: var(--dsw-alias-state-success-primary, #16a34a); border-radius: 999px; padding: 0 8px; font-size: 11px; }',
        '.dsh-market-version { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }',
        '.dsh-market-acts { display: flex; gap: 6px; flex-wrap: wrap; }',
        '.dsh-market-update-banner { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid rgba(59,130,246,0.6); background: rgba(59,130,246,0.08); border-radius: 8px; padding: 8px 12px; font-size: 12px; }',
        '.dsh-market-update-banner b { color: var(--dsw-alias-state-business-primary, #3b82f6); }',
        '.dsh-market-err { color: #e5534b; font-size: 12px; }',
        '.dsh-market-empty { font-size: 12px; opacity: 0.6; padding: 8px 0; }',
        '.dsh-market-out { font-size: 11px; opacity: 0.7; }',
        '.dsh-market-restart-note { font-size: 11px; opacity: 0.7; padding-top: 4px; }',
        '.dsh-market-desc-row { display: flex; align-items: flex-start; gap: 6px; }',
        '.dsh-market-desc { flex: 1; min-width: 0; }',
        '.dsh-market-tr { flex-shrink: 0; align-self: flex-start; }',
        '.dsh-market-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }',
        '.dsh-market-modal { max-width: 560px; width: 90vw; max-height: 70vh; overflow: auto; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.4)); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.3); }',
        '.dsh-market-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
        '.dsh-market-modal-title { font-weight: 600; font-size: 14px; word-break: break-all; }',
        '.dsh-market-modal-close { cursor: pointer; border: none; background: transparent; color: inherit; font-size: 20px; line-height: 1; opacity: 0.7; }',
        '.dsh-market-modal-close:hover { opacity: 1; }',
        '.dsh-market-modal-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }',
        '.dsh-market-modal-orig { opacity: 0.65; font-size: 12px; border-bottom: 1px dashed rgba(128,128,128,0.4); padding-bottom: 8px; }',
        // ── app-store style progress ──
        '.dsh-market-progress { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }',
        '.dsh-market-progress-head { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }',
        '.dsh-market-progress-phase { font-weight: 600; }',
        '.dsh-market-progress-pct { font-variant-numeric: tabular-nums; }',
        '.dsh-market-progress-stats { opacity: 0.75; font-size: 11px; font-variant-numeric: tabular-nums; }',
        '.dsh-market-progress-track { height: 6px; border-radius: 999px; background: rgba(128,128,128,0.25); overflow: hidden; position: relative; }',
        '.dsh-market-progress-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary, #3b82f6); transition: width .3s ease; }',
        '.dsh-market-progress-fill.indeterminate { width: 40% !important; animation: dshMarketSlide 1.2s ease-in-out infinite; }',
        '@keyframes dshMarketSlide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }',
        '.dsh-market-progress-meta { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }',
        '.dsh-market-progress-log { font-size: 10px; opacity: 0.6; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; max-height: 60px; overflow: hidden; }',
      ].join(' ')
      document.head.appendChild(tag)
    }

    var React = require('react')

    // ── localization (canonical dsh pattern) ───────────────────────────
    // MARKET_LOCALES is injected by the build from src/locales.js.
    var LOCALE_NS = 'settings.marketplace'
    // Identity fallback until apply() binds the real translator.
    var T = function (key) { return MARKET_LOCALES && MARKET_LOCALES.zh && MARKET_LOCALES.zh[key] ? MARKET_LOCALES.zh[key] : key }

    var PAGE_SIZE = 50

    // Set in apply(ctx); lets components reach the client runtime's sessions /
    // workspaces services (to open a dedicated install conversation).
    var clientCtx = null

    // ── shared helpers ─────────────────────────────────────────────────────
    function fmtBytes(n) {
      n = Number(n) || 0
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
      return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    }
    function fmtSpeed(bps) {
      bps = Number(bps) || 0
      if (bps <= 0) return ''
      if (bps < 1024) return bps + ' B/s'
      if (bps < 1024 * 1024) return (bps / 1024).toFixed(0) + ' KB/s'
      return (bps / (1024 * 1024)).toFixed(1) + ' MB/s'
    }
    var PHASE_LABEL_KEY = {
      pending: 'preparing',
      resolving: 'resolving',
      downloading: 'downloading',
      installing: 'installing',
      done: 'done',
      error: 'failed',
      canceled: 'canceled',
    }
    function phaseLabel(phase) {
      var key = PHASE_LABEL_KEY[phase]
      var label = key ? T(key) : ''
      return label || phase || ''
    }
    // Poll an install/update job; onProgress(job) each tick, onDone(job) once
    // (a "not found" response is reported as a done error so polling always
    // terminates). Returns a stop() function.
    function startPolling(jobId, onProgress, onDone) {
      var stopped = false
      var timer = setInterval(function () {
        fetch('/api/market/install/status?job=' + encodeURIComponent(jobId), { cache: 'no-store' })
          .then(function (r) { return r.json() })
          .then(function (data) {
            if (stopped) return
            var job = data && data.job
            if (!job) { stop(); onDone({ done: true, ok: false, error: T("taskExpired") }); return }
            onProgress(job)
            if (job.done) { stop(); onDone(job) }
          })
          .catch(function () { /* transient network noise — keep polling */ })
      }, 500)
      function stop() { stopped = true; clearInterval(timer) }
      return stop
    }
    function cancelJobId(jobId) {
      if (!jobId) return
      fetch('/api/market/install/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: jobId }),
      }).catch(function () {})
    }

    /**
     * Shared session RPC helper (the same envelope the chat composer uses).
     */
    function mktRpc(method, payload) {
      return fetch('/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'mkt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), method: method, payload: payload }),
      }).then(function (res) { return res.json() })
    }

    /** Prompt one specific session (the RPC the chat composer uses). */
    function promptSession(sessionId, text) {
      return mktRpc('session.prompt', { sessionId: sessionId, mode: 'queue', content: [{ type: 'text', text: text }] })
        .then(function (res) {
          if (!res || !res.result || !res.result.ok) {
            var err = res && res.result && res.result.error
            throw new Error((err && (err.code + ': ' + err.message)) || T("sendToAgentFailed"))
          }
          return true
        })
    }

    /**
     * Fallback: prompt the current agent session (used only when the client
     * runtime workspaces/sessions services are unavailable). The primary
     * path opens a dedicated workspace + new conversation instead.
     */
    function sendToAgent(text) {
      return mktRpc('session.list', {})
        .then(function (res) {
          var items = res && res.result && res.result.ok && res.result.value && res.result.value.items
          if (!Array.isArray(items) || items.length === 0) throw new Error(T("noSession"))
          // session.list 按最近更新排序，第一条即当前会话；跳过空白会话。
          var session = items.find(function (s) { return !s.blank }) || items[0]
          return promptSession(session.sessionId, text)
        })
    }

    // ── Progress panel (app-store style) ───────────────────────────────────
    function ProgressPanel(props) {
      var job = props.job
      var onCancel = props.onCancel
      var percent = job && job.percent
      var indeterminate = !(typeof percent === 'number' && percent >= 0)
      var phaseLabelText = job ? phaseLabel(job.phase) : T("preparing")
      var stats = []
      if (job && job.bytesDown > 0) stats.push(T("downloaded") + fmtBytes(job.bytesDown))
      // The "total" is a best-effort estimate from direct dependency sizes; it
      // is only meaningful while it still exceeds what we have already
      // downloaded, otherwise it would show a misleadingly small total.
      if (job && job.bytesTotal > 0 && job.bytesTotal >= job.bytesDown) stats.push(T("about") + fmtBytes(job.bytesTotal))
      if (job) { var spd = fmtSpeed(job.speedBps); if (spd) stats.push(spd) }
      if (job && typeof job.etaSec === 'number' && job.phase === 'downloading') stats.push(T("eta") + job.etaSec + 's' + T("etaSuffix"))
      var pkgLine = null
      if (job && job.packages && job.packages.resolved > 0) {
        var p = job.packages
        pkgLine = T("depsPrefix") + p.resolved + T("depsReused") + p.reused + T("depsDownload") + p.downloaded + T("depsAdded") + p.added + T("closeParen")
      }
      var fill = React.createElement('div', {
        className: 'dsh-market-progress-fill' + (indeterminate ? ' indeterminate' : ''),
        style: { width: indeterminate ? '40%' : (percent + '%') },
      })
      return React.createElement('div', { className: 'dsh-market-progress' },
        React.createElement('div', { className: 'dsh-market-progress-head' },
          React.createElement('span', { className: 'dsh-market-progress-phase' }, phaseLabelText),
          React.createElement('span', { className: 'dsh-market-progress-pct' }, indeterminate ? '…' : (percent + '%')),
          stats.length ? React.createElement('span', { className: 'dsh-market-progress-stats' }, stats.join(' · ')) : null,
          onCancel ? React.createElement('button', { className: 'dsh-market-act', 'data-kind': 'danger', onClick: onCancel }, T("cancel")) : null,
        ),
        React.createElement('div', { className: 'dsh-market-progress-track' }, fill),
        job && job.step ? React.createElement('div', { className: 'dsh-market-progress-meta' }, job.step) : null,
        pkgLine ? React.createElement('div', { className: 'dsh-market-progress-meta' }, pkgLine) : null,
        job && job.log && job.log.length
          ? React.createElement('div', { className: 'dsh-market-progress-log' }, job.log.slice(-3).join('\n'))
          : null,
      )
    }

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
          .then(function (d) {
            if (d && d.jobId) {
              startPolling(d.jobId,
                function () { /* live progress on the banner is overkill; keep button state */ },
                function (job) { set(function (x) { return Object.assign({}, x, { updating: false, done: job }) }) })
            } else {
              set(function (x) { return Object.assign({}, x, { updating: false, done: d }) })
            }
          })
          .catch(function () { set(function (x) { return Object.assign({}, x, { updating: false, done: { ok: false, error: T("networkError") } }) }) })
      }
      return React.createElement('div', { className: 'dsh-market-update-banner' },
        React.createElement('span', null, T("updateAvailable"), React.createElement('b', null, 'v' + s.self.version + ' → v' + s.self.latestVersion), T("period")),
        React.createElement('button', { className: 'dsh-market-act', 'data-kind': 'update', onClick: doUpdate, disabled: s.updating }, s.updating ? T("updating") : T("updateNow")),
        s.done
          ? React.createElement('span', { className: s.done.ok ? 'dsh-market-out' : 'dsh-market-err' },
            s.done.ok ? T("updatedRestart") : (T("updateFailed") + (s.done.error || T("unknownError"))))
          : null,
      )
    }

    // ── 翻译弹窗: shows the translated description ──────────────────────
    function TranslateModal(props) {
      if (!props.open) return null
      var body
      if (props.loading) {
        body = React.createElement('div', { className: 'dsh-market-modal-body' }, T("translating"))
      } else if (props.error) {
        body = React.createElement('div', { className: 'dsh-market-modal-body dsh-market-err' }, T("translationFailed") + props.error)
      } else if (props.translated) {
        body = React.createElement('div', { className: 'dsh-market-modal-body' },
          props.original
            ? React.createElement('div', { className: 'dsh-market-modal-orig' }, T("original") + props.original)
            : null,
          React.createElement('div', null, props.translated),
        )
      } else {
        body = React.createElement('div', { className: 'dsh-market-modal-body' }, T("noTranslation"))
      }
      return React.createElement('div', { className: 'dsh-market-modal-overlay', onClick: props.onClose },
        React.createElement('div', { className: 'dsh-market-modal', onClick: function (e) { e.stopPropagation() } },
          React.createElement('div', { className: 'dsh-market-modal-head' },
            React.createElement('span', { className: 'dsh-market-modal-title' }, props.title || T("descriptionTranslate")),
            React.createElement('button', { className: 'dsh-market-modal-close', onClick: props.onClose }, '×'),
          ),
          body,
        ),
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
      // installs: keyed by repo fullName →
      //   { status: 'idle'|'installing'|'installed'|'error', progress, jobId, error, output }
      var installState = React.useState({})
      var setInstallState = installState[1]
      var installs = installState[0]

      // ══ 默认安装入口：直装（确定性的 /api/market/install 异步任务 + 进度条）══
      // host 侧 `planInstall` 会区分「根级插件 / monorepo 工作区」两条路径，
      // 安装后校验是否真的可加载（进了 dsh.profile.bundles 且入口存在），
      // 误装成普通依赖时会自动回滚并改走 workspace 路径，失败给出明确原因。
      var install = function install(it) {
        var key = it.fullName
        var spec = key // fullName is owner/repo — pnpm accepts it directly
        setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'installing', progress: null, jobId: null, error: null, output: '' } }) })
        fetch('/api/market/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spec: spec }),
        })
          .then(function (res) { return res.json() })
          .then(function (data) {
            if (data && data.jobId) {
              setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'installing', progress: null, jobId: data.jobId, error: null, output: '' } }) })
              startPolling(data.jobId,
                function (job) {
                  setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'installing', progress: job, jobId: data.jobId, error: null, output: job.output || '' } }) })
                },
                function (job) {
                  setInstallState(function (s) {
                    return Object.assign({}, s, { [key]: job && job.ok
                      ? { status: 'installed' }
                      : { status: 'error', error: (job && job.error) || T("installFailed"), output: (job && job.output) || '' } })
                  })
                })
            } else if (data && typeof data.ok !== 'undefined') {
              setInstallState(function (s) {
                return Object.assign({}, s, { [key]: data.ok
                  ? { status: 'installed' }
                  : { status: 'error', error: data.error || T("installFailed"), output: data.output || '' } })
              })
            } else {
              setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'error', error: (data && data.error) || T("installFailed") } }) })
            }
          })
          .catch(function () {
            setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'error', error: T("networkError") } }) })
          })
      }

      // ══ 隐藏：agent 安装方案（代码保留、不接入 UI）══
      // 兼容性兜底：由 agent 读仓库 README 并决定如何安装（能处理直装覆盖不了的
      // 非标准结构）。当前直装为默认，此路径暂不暴露，代码保留以便后续恢复/改造。
      var installViaAgent = function installViaAgent(it) {
        var key = it.fullName
        var spec = key
        var text = T("agentIntro1") + spec + T("agentIntro2")
          + T("agentStep1a") + spec + T("agentStep1b")
          + T("agentStep1c")
          + T("agentStep2a")
          + T("agentStep2b")
          + T("agentStep3a")
          + T("agentStep3b")
          + T("agentStep4")
          + T("agentStep5")
        setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'sending' } }) })
        // 首选：在「专属安装工作区」新开对话，把安装任务发给那个会话（不污染当前会话，
        // 也不要求用户手动选工作区）。host 负责创建专属工作区目录；client runtime 的
        // workspaces/sessions 服务负责注册工作区、建会话并切过去。服务不可用时回退到
        // 「发给当前会话」。
        var sessions = clientCtx && clientCtx.sessions
        var workspaces = clientCtx && clientCtx.workspaces
        var openDedicated = !!(sessions && workspaces && sessions.create && sessions.open && workspaces.create)
        var p = openDedicated
          ? fetch('/api/market/install-workspace', { cache: 'no-store' })
              .then(function (res) { return res.json() })
              .then(function (ws) {
                if (!ws || !ws.ok || !ws.path) throw new Error(T("wsPathFailed"))
                return workspaces.create({ path: ws.path })
              })
              .then(function (wv) {
                var wsId = wv && (wv.workspaceId || wv.id)
                if (!wsId) throw new Error(T("wsRegisterFailed"))
                return sessions.create({ workspaceId: wsId })
              })
              .then(function (sessionId) {
                sessions.open(sessionId)
                return promptSession(sessionId, text)
              })
          : sendToAgent(text)
        p
          .then(function () {
            setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'sent' } }) })
          })
          .catch(function (e) {
            setInstallState(function (s) { return Object.assign({}, s, { [key]: { status: 'error', error: String((e && e.message) || e) } }) })
          })
      }

      var installLabel = function (st) {
        if (st.status === 'sending') return T("sending")
        if (st.status === 'sent') return T("handedOff")
        if (st.status === 'installing') return T("installingShort")
        if (st.status === 'installed') return T("installed")
        if (st.status === 'error') return T("retry")
        return T("install")
      }

      // translate state: keyed by repo fullName → popup with translated text
      var trans = React.useState({ open: false, key: '', loading: false, original: '', translated: '', error: null })
      var setTrans = trans[1]
      var t = trans[0]

      var onTranslate = function (it) {
        var desc = String(it.description || '').trim()
        setTrans({ open: true, key: it.fullName, loading: true, original: desc, translated: '', error: null })
        fetch('/api/market/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: desc }),
        })
          .then(function (r) { return r.json() })
          .then(function (d) {
            setTrans(function (s) {
              return s.key !== it.fullName
                ? s
                : Object.assign({}, s, {
                    loading: false,
                    translated: (d && d.ok) ? d.text : '',
                    error: (d && d.ok) ? null : ((d && d.error) || T("translateFailed")),
                  })
            })
          })
          .catch(function () {
            setTrans(function (s) { return Object.assign({}, s, { loading: false, error: T("networkError") }) })
          })
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
          React.createElement('span', { className: 'dsh-market-title' }, T("marketTitle")),
          React.createElement('span', { className: 'dsh-market-meta' }, T("totalPrefix") + current.total + T("showingSuffix") + shown + T("syncedAt") + time),
          React.createElement('input', {
            className: 'dsh-market-search',
            placeholder: T("searchPlaceholder"),
            value: q,
            onChange: onSearch,
          }),
          React.createElement('button', { className: 'dsh-market-refresh', onClick: onRefresh, disabled: current.loading }, current.loading ? T("syncing") : T("refresh")),
        ),
        React.createElement('div', { className: 'dsh-market-out' },
          T("sourceLabel"),
          React.createElement('a', { href: 'https://github.com/topics/dsh-plugin', target: '_blank', rel: 'noreferrer' }, T("topicLabel")),
          T("sourceNote"),
        ),
        current.error ? React.createElement('div', { className: 'dsh-market-err' }, T("syncFailed") + current.error) : null,
        current.loading && current.items.length === 0
          ? React.createElement('div', { className: 'dsh-market-empty' }, T("syncingAlt"))
          : (current.items.length === 0
            ? React.createElement('div', { className: 'dsh-market-empty' }, q.trim() ? T("noMatch") : T("noPluginData"))
            : React.createElement('div', null,
              current.items.map(function (it) {
                var key = it.fullName
                // A repo already installed in the profile (reported by the host)
                // starts as "已安装" so the install button is disabled on load.
                var st = installs[key] || { status: it.installed ? 'installed' : 'idle' }
                var sending = st.status === 'sending'
                var sent = st.status === 'sent'
                var installing = st.status === 'installing'
                var installed = st.status === 'installed'
                var failed = st.status === 'error'
                var btn = React.createElement('button', {
                  className: 'dsh-market-install',
                  'data-state': st.status,
                  onClick: function () { install(it) },
                  disabled: sending || sent || installing || installed,
                }, installLabel(st))
                return React.createElement('div', { key: it.url + it.fullName, className: 'dsh-market-card' },
                  React.createElement('div', { className: 'dsh-market-card-head' },
                    React.createElement('a', { href: it.url, target: '_blank', rel: 'noreferrer' }, it.fullName),
                    btn,
                  ),
                  React.createElement('div', { className: 'dsh-market-desc-row' },
                    React.createElement('div', { className: 'dsh-market-desc' }, it.description),
                    it.description
                      ? React.createElement('button', { className: 'dsh-market-tr', onClick: function () { onTranslate(it) }, disabled: t.loading && t.key === it.fullName }, (t.loading && t.key === it.fullName) ? T("translating") : T("translate"))
                      : null,
                  ),
                  React.createElement('div', { className: 'dsh-market-tags' },
                    React.createElement('span', { className: 'dsh-market-tag' }, '★ ' + it.stars),
                    it.language ? React.createElement('span', { className: 'dsh-market-tag' }, it.language) : null,
                  ),
                  sending
                    ? React.createElement('div', { className: 'dsh-market-install-note' }, T("sendingToAgent"))
                    : (sent
                      ? React.createElement('div', { className: 'dsh-market-install-note' }, T("handedOffDetail"))
                      : (installing
                        ? React.createElement(ProgressPanel, {
                            job: st.progress,
                            onCancel: st.jobId ? function () { cancelJobId(st.jobId) } : null,
                          })
                        : (installed
                          ? React.createElement('div', { className: 'dsh-market-install-note' }, it.needsRestart ? T("installedRestart") : T("installed"))
                          : (failed
                            ? React.createElement('div', { className: 'dsh-market-install-note' },
                                T("directInstallFailed") + (st.error || T("unknownError")) + T("sentenceSep") + T("directInstallAdvice"),
                                st.output ? React.createElement('pre', { className: 'dsh-market-progress-log' }, st.output.slice(-800)) : null,
                                React.createElement('button', {
                                  className: 'dsh-market-act', 'data-kind': 'update', style: { marginTop: '4px' },
                                  onClick: function () { installViaAgent(it) },
                                }, T("installViaAgent")))
                            : null)))),
                )
              }),
              current.hasMore
                ? React.createElement('div', { style: { padding: '8px 0', textAlign: 'center' } },
                  React.createElement('button', { className: 'dsh-market-more', onClick: onMore, disabled: current.loading }, current.loading ? T("loading") : T("loadMore")))
                : null,
            )),
        React.createElement(TranslateModal, {
          open: t.open,
          title: t.key ? (T("translatePrefix") + t.key) : T("descriptionTranslate"),
          original: t.original,
          translated: t.translated,
          loading: t.loading,
          error: t.error,
          onClose: function () { setTrans(function (s) { return Object.assign({}, s, { open: false }) }) },
        }),
      )
    }

    // ── 已安装 tab: update / disable / enable / uninstall ─────────────────
    function InstalledTab() {
      var state = React.useState({ loading: false, plugins: [], self: null, error: null, fetchedAt: 0 })
      var setState = state[1]
      var current = state[0]
      // acts: keyed by plugin name → { busy, done, confirmUninstall, progress, jobId }
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
        setAct(function (s) { return Object.assign({}, s, { [name]: { busy: true, done: null, confirmUninstall: false, progress: null, jobId: null } }) })
        fetch('/api/market/' + kind, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || { name: name }),
        })
          .then(function (res) { return res.json() })
          .then(function (d) {
            if (d && d.jobId) {
              // async host: poll the update job
              startPolling(d.jobId,
                function (job) {
                  setAct(function (s) { return Object.assign({}, s, { [name]: { busy: true, done: null, confirmUninstall: false, progress: job, jobId: d.jobId } }) })
                },
                function (job) {
                  setAct(function (s) {
                    return Object.assign({}, s, { [name]: {
                      busy: false,
                      done: { ok: !!(job && job.ok), error: (job && job.error) || (job && job.ok ? null : T("operationFailed")), output: job && job.output },
                      confirmUninstall: false,
                      progress: job && job.done ? null : null,
                      jobId: d.jobId,
                    } })
                  })
                  if (job && job.ok) load()
                })
            } else if (d && typeof d.ok !== 'undefined') {
              // old synchronous host
              setAct(function (s) { return Object.assign({}, s, { [name]: { busy: false, done: d, confirmUninstall: false, progress: null, jobId: null } }) })
              if (d.ok) load()
            } else {
              setAct(function (s) { return Object.assign({}, s, { [name]: { busy: false, done: { ok: false, error: (d && d.error) || T("operationFailed") }, confirmUninstall: false, progress: null, jobId: null } }) })
            }
          })
          .catch(function () {
            setAct(function (s) { return Object.assign({}, s, { [name]: { busy: false, done: { ok: false, error: T("networkError") }, confirmUninstall: false, progress: null, jobId: null } }) })
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
      // Only user-installed (third-party) plugins are shown here; built-ins
      // ship with the harness. The filter is defensive against a host that is
      // not yet restarted (it may still include builtin entries).
      var shown = current.plugins.filter(function (p) { return p.kind !== 'builtin' })
      var updatable = 0
      shown.forEach(function (p) { if (p.updateAvailable) updatable += 1 })

      return React.createElement('div', { className: 'dsh-market' },
        React.createElement('div', { className: 'dsh-market-head' },
          React.createElement('span', { className: 'dsh-market-title' }, T("installedTitle")),
          React.createElement('span', { className: 'dsh-market-meta' }, T("totalPrefix") + shown.length + T("countSuffix") + (updatable ? ' · ' + updatable + T("updatableSuffix") : '')),
          React.createElement('button', { className: 'dsh-market-refresh', onClick: load, disabled: current.loading }, current.loading ? T("reading") : T("refresh")),
        ),
        React.createElement(SelfUpdateBanner, null),
        React.createElement('div', { className: 'dsh-market-out' }, T("thirdPartyNote")),
        current.error ? React.createElement('div', { className: 'dsh-market-err' }, T("readFailed") + current.error) : null,
        current.loading && shown.length === 0
          ? React.createElement('div', { className: 'dsh-market-empty' }, T("readingAlt"))
          : (shown.length === 0
            ? React.createElement('div', { className: 'dsh-market-empty' }, T("noThirdParty"))
            : React.createElement('div', null,
              shown.map(function (p) {
                var self = isSelf(p)
                var a = acts[p.name] || {}
                var busy = !!a.busy
                var done = a.done
                var actions = []
                if (p.updateAvailable) {
                  actions.push(React.createElement('button', {
                    key: 'update', className: 'dsh-market-act', 'data-kind': 'update',
                    onClick: function () { run(p.name, 'update') }, disabled: busy,
                  }, busy ? T("updating") : T("updateTo") + p.latestVersion))
                }
                if (!self) {
                  actions.push(React.createElement('button', {
                    key: 'toggle', className: 'dsh-market-act', 'data-kind': p.enabled ? 'muted' : 'update',
                    onClick: function () { run(p.name, 'set-enabled', { name: p.name, enabled: !p.enabled }) }, disabled: busy,
                  }, busy ? T("processing") : (p.enabled ? T("disable") : T("enable"))))
                  actions.push(React.createElement('button', {
                    key: 'uninstall', className: 'dsh-market-act', 'data-kind': 'danger',
                    onClick: function () { onUninstall(p.name) }, disabled: busy,
                  }, busy ? T("uninstalling") : (a.confirmUninstall ? T("confirmUninstall") : T("uninstall"))))
                }
                var note = done
                  ? (done.ok
                    ? React.createElement('div', { className: 'dsh-market-out' }, T("executedRestart"))
                    : React.createElement('div', { className: 'dsh-market-err' }, T("operationFailedColon") + (done.error || T("unknownError"))))
                  : null
                return React.createElement('div', { key: p.name, className: 'dsh-market-card' },
                  React.createElement('div', { className: 'dsh-market-card-head' },
                    React.createElement('div', { className: 'dsh-market-namebox' },
                      p.homepage
                        ? React.createElement('a', { href: p.homepage, target: '_blank', rel: 'noreferrer' }, p.name)
                        : React.createElement('strong', null, p.name),
                      self ? React.createElement('span', { className: 'dsh-market-tag-self' }, T("thisPlugin")) : null,
                      p.updateAvailable ? React.createElement('span', { className: 'dsh-market-tag-new' }, T("updateAvailableV") + p.latestVersion) : null,
                      !p.enabled ? React.createElement('span', { className: 'dsh-market-tag' }, T("disabledTag")) : null,
                    ),
                    actions.length > 0 ? React.createElement('div', { className: 'dsh-market-acts' }, actions) : null,
                  ),
                  React.createElement('div', { className: 'dsh-market-version' },
                    p.version ? ('v' + p.version) : T("unknownVersion"),
                    p.latestVersion ? (T("latestV") + p.latestVersion) : '',
                  ),
                  a.progress
                    ? React.createElement(ProgressPanel, { job: a.progress, onCancel: a.jobId ? function () { cancelJobId(a.jobId) } : null })
                    : null,
                  p.description ? React.createElement('div', { className: 'dsh-market-desc' }, p.description) : null,
                  self ? React.createElement('div', { className: 'dsh-market-out' }, T("selfNote")) : null,
                  note,
                )
              }),
              React.createElement('div', { className: 'dsh-market-restart-note' }, T("restartNote")),
            )),
      )
    }

    var inject = ['slots', 'sessions', 'workspaces', 'locale']

    function apply(ctx) {
      clientCtx = ctx
      ctx.effect(function () { ctx.locale.register(LOCALE_NS, MARKET_LOCALES) }, 'marketplace: dictionaries')
      T = ctx.locale.bind(LOCALE_NS)
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register(
          { name: 'settings.plugins.tab', id: 'market', order: 5, label: function () { return T("marketTitle") } },
          MarketTab,
        )
      })
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register(
          { name: 'settings.plugins.tab', id: 'installed', order: 6, label: function () { return T("installedTitle") } },
          InstalledTab,
        )
      })
    }

        exports.inject = inject
    exports.apply = apply

    return module.exports
  },
})
