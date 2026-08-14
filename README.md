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
- **一键安装** — 每个插件卡片都有 **安装** 按钮，POST `/api/market/install`，并显示 安装中 / 已安装 / 失败 状态。
- **并入插件设置** — 注册 `settings.plugins.tab`（id `market`），插件市场与自带的"插件配置"、"插件列表"并列。

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
| Host 半 | `lib/index.js` | GitHub 分页同步 + `/api/market/list` + `/api/market/install` + `market_search`/`market_install` 工具 |
| Client 半 | `lib/client.js` | `__ModuleLoader__` bundle：插件设置标签页 + 搜索 + 加载更多 + 一键安装 |

数据走 Host 半在 `ctx.webServer` 上注册的同源 HTTP 端点（`/api/market/list`）——永久插件没有 `harness`/`host.call` 沙箱 RPC，所以浏览器半用 `fetch`。

## 开发

```sh
npm run check   # 语法检查两个半
```

## License

MIT
