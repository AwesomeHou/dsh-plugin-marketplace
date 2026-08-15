# dsh-plugin-marketplace

[English](README.en.md) | 中文

[![GitHub](https://img.shields.io/badge/GitHub-AwesomeHou%2Fdsh--plugin--marketplace-181717?logo=github)](https://github.com/AwesomeHou/dsh-plugin-marketplace)

一个 DeepSeek Harness 的**永久插件**，把 GitHub
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic（1800+ 仓库）变成**插件市场**——既是 **设置 → 插件** 里的一个标签页，也提供一组模型工具，让 agent 自己就能搜索并安装插件。

![插件市场截图](screenshot.png)

*插件市场：搜索、浏览、一键安装。*

## 功能

- **全量分页** — 完整 topic 按页拉取（默认 50 / 最大 100），UI 带"加载更多"按钮。不再有"只看 50 个"的硬限制：`total` 反映真实的 `total_count`。
- **搜索** — 关键词搜索走 GitHub 自己的 `q`（所以是在**整个 topic** 里搜，而不是只在已加载的页里过滤），UI 搜索框和 `market_search` 工具都用它。
- **Agent 工具**（Host 侧通过 `ctx.tools.register` 注册）：
  - `market_search(q?, page?, perPage?)` — 返回 topic 仓库的 JSON 列表（full name、star、语言、简介、URL）。
  - `market_install(spec)` — 通过 `dsh plugin --profile web add -w <spec>` 安装到 `web` profile。执行前会校验 spec 是否含 shell 元字符；完成后提示需要重启 harness。
  - `market_installed()` — 列出 `web` profile 已安装的**第三方**插件：启用状态、当前版本、最新版本与是否可更新（含市场自身的更新状态）。内置插件不在此列。
  - `market_update(name)` — 把某个已安装插件更新到最新版本（需重启 harness 生效）。
- **一键安装** — 每个插件卡片都有 **安装** 按钮，POST `/api/market/install`，并显示 安装中 / 已安装 / 失败 状态。
- **更新插件（有新版本提示）** — 每个已安装插件都会对照最新版本（npm registry 的 `latest`，或 GitHub 默认分支 `package.json` 的 `version`，GitHub 插件优先）。有新版本时在卡片上标 **可更新** 并给 **更新** 按钮（`/api/market/update`）。
- **区分内置 / 后安装** — `dsh.profile.bundles` 里来自 profile 模板的包是**内置**插件（随 harness 提供，不能关闭 / 卸载），`dependencies` 里的是**后安装**插件。**已安装**标签页只展示后安装（第三方）插件，内置插件不列出（页面顶部有声明）。
- **后安装插件可关闭 / 卸载** — **关闭 / 启用**（`/api/market/set-enabled`）通过把它移出 / 移回 `dsh.profile.bundles` 实现（依赖保留）；**卸载**（`/api/market/uninstall`）通过 `dsh plugin --profile web remove <name>` 移除依赖并自动从 bundle 层摘除。两者都需重启 harness。
- **市场自更新检查** — 插件市场（本插件）会检查自己的最新版本（从其 GitHub 仓库 `package.json` 读取）。有新版本时在"插件市场"和"已安装"两个标签页顶部显示横幅：`vX → vY · 立即更新`。
- **声明来源** — **插件市场**标签页顶部声明插件清单的来源：GitHub `dsh-plugin` 话题（`github.com/topics/dsh-plugin`），通过 GitHub Search API 实时同步。
- **并入插件设置** — 注册两个 `settings.plugins.tab`（`market` 插件市场、`installed` 已安装），与自带的"插件配置"、"插件列表"并列。

## 安装

### 手动安装

```sh
dsh plugin --profile web add https://github.com/AwesomeHou/dsh-plugin-marketplace
```

安装后需**重启 harness** 才能生效。

### 让 Agent 安装

```
帮我安装这个插件 https://github.com/AwesomeHou/dsh-plugin-marketplace
```

## 结构

| 部件 | 文件 | 作用 |
|---|---|---|
| Bundle 清单 | `package.json` | 声明 `dsh.bundle.patch`（host 层）+ `dsh.client`（浏览器模块） |
| Patch 层 | `cordis.patch.yml` | 把插件自己的 host 行插入 Loader 树 |
| Host 半 | `lib/index.js` | GitHub 分页同步 + `/api/market/list`、`/api/market/installed`、`/api/market/update`、`/api/market/set-enabled`、`/api/market/uninstall` + `market_search`/`market_install`/`market_installed`/`market_update` 工具 |
| Client 半 | `lib/client.js` | `__ModuleLoader__` bundle：`插件市场` / `已安装` 两个设置标签页 + 搜索 + 加载更多 + 一键安装 + 更新 / 关闭 / 启用 / 卸载 + 市场自更新横幅 |

数据走 Host 半在 `ctx.webServer` 上注册的同源 HTTP 端点（`/api/market/*`）——永久插件没有 `harness`/`host.call` 沙箱 RPC，所以浏览器半用 `fetch`。

## 开发

```sh
npm run check   # 语法检查两个半
```

## License

MIT
