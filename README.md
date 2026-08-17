# dsh-plugin-marketplace

[English](README.en.md) | 中文

[![GitHub](https://img.shields.io/badge/GitHub-AwesomeHou%2Fdsh--plugin--marketplace-181717?logo=github)](https://github.com/AwesomeHou/dsh-plugin-marketplace)

一个 DeepSeek Harness 的**永久插件**，把 GitHub
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 变成**插件市场**——既是 **设置 → 插件** 里的标签页，也提供一组模型工具，让 agent 自己就能搜索并安装插件。

![插件市场截图](screenshot1.png)
![插件市场截图](screenshot2.png)

*插件市场：搜索、浏览、一键安装、检查更新。*

## 功能

- **全量分页** — 完整 topic 按页拉取（默认 50 / 最大 100），UI 带"加载更多"按钮。不再有"只看 50 个"的硬限制：`total` 反映真实的 `total_count`。
- **搜索** — 关键词搜索走 GitHub 自己的 `q`（所以是在**整个 topic** 里搜，而不是只在已加载的页里过滤），UI 搜索框和 `market_search` 工具都用它。
- **Agent 工具**（Host 侧通过 `ctx.tools.register` 注册）：
  - `market_search(q?, page?, perPage?)` — 返回 topic 仓库的 JSON 列表（full name、star、语言、简介、URL）。
  - `market_install(spec)` — 通过 `dsh plugin --profile web add -w <spec>` 安装到 `web` profile。执行前会校验 spec 是否含 shell 元字符；完成后提示需要重启 harness。
  - `market_installed()` — 列出 `web` profile 已安装的**第三方**插件：启用状态、当前版本、最新版本与是否可更新（含市场自身的更新状态）。内置插件不在此列。
  - `market_update(name)` — 把某个已安装插件更新到最新版本（需重启 harness 生效）。
- **安装（默认：直装，优先 npm 包）** — 每个插件卡片都有 **安装** 按钮，点击后通过 `POST /api/market/install` 启动**确定性的异步安装任务**：host 侧 `planInstall` 先探测仓库形态——根 `package.json` 声明了 `dsh.bundle`/`dsh.client` 的**根级插件**走标准 `dsh plugin add -w <spec>`；**已发布到 npm 的插件优先用 `name@<latest>` 装 npm 版**（快、稳、免 GitHub 拉取，pnpm 把插件及运行时依赖如 `ws`/`node-pty` 一起装进 profile）；未发布到 npm 的用 github spec；monorepo/workspace 根则克隆到 `$DSH_HOME/marketplace-src`、corepack pnpm 构建后 `link:` 注册（沙箱内自带 node_modules，依赖可解析）。装完做**真实结果校验**（进入 `dsh.profile.bundles`、入口文件存在、**运行时依赖可解析**——后一条专门防“link 缺依赖导致启动失败”的历史回归）。**注意：不能用 `link:` 装根级插件**。卡片内联渲染 App Store 式进度条（阶段 / 百分比 / 已下载 / 速度 / ETA / 实时日志），可取消。
- **pnpm 兼容层（借鉴 dsh-market）** — 所有安装子进程注入 `CI=true`（pnpm ≥10 无 TTY 时不再无限等交互提示而卡死，遇错直接报错）；检测到 **pnpm 大版本漂移**（`ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF` / `PUBLIC_HOIST_PATTERN_DIFF`，即 modules 目录由别的 pnpm 大版本创建）会**自动 `pnpm install` 重建 modules 目录并重试一次**。失败分类 `classifyPnpmFailure` 覆盖：预发布 peer 解析、构建脚本拦截（`IGNORED_BUILDS`/`GIT_DEP_PREPARE_NOT_ALLOWED`）、幽灵依赖 404、发布新鲜度等待期、workspace 缺失、pnpm 缺失等，统一给**可操作文案**而不是裸报错。
- **安装卡住自动止损** — pnpm / git 在死网络或过慢的下载上可能**零输出挂死**（例如 GitHub 暂不可达时停在"正在解析依赖… 8%"）。host 侧带**停滞看门狗**：一段时间（默认 120s，可用 `DSH_MARKET_STALL_MS` 覆盖）没有任何进度（无输出行、无字节增长）就杀掉进程树 → 自动**直连重试一次**（去掉字节统计代理）→ 若再次停滞则**快速失败**并提示「检查网络后重试，或改用「让 agent 安装」」，不再无限转圈等到 10 分钟超时。
- **对等依赖失败识别** — 若插件声明了 `@deepseek-ai/*@^0.1.0-rc.6` 这类**预发布对等依赖**，`dsh plugin add` 可能以 `ERR_PNPM_NO_MATCHING_VERSION` 退出。host 侧会识别并给出**可操作的说明**（而不是裸的 "exit 1"），卡片同时提供 **「让 agent 安装」** 兜底按钮——agent 会按仓库 README / 安装脚本处理这类结构。
- **workspace 缺失的友好报错** — host 侧在安装/更新前检查 web profile：`package.json` 或 `pnpm-workspace.yaml` 缺失时，`market_install` / `/api/market/install` 会返回可操作的错误信息（告诉用户如何创建 `pnpm-workspace.yaml` 或重新初始化 profile），而不是 pnpm 那种晦涩的 `--workspace-root may only be used inside a workspace`。
- **agent 安装方案（兜底，专属工作区新开对话）** — 当直装失败时（尤其对等依赖 / 非标准结构场景），卡片上会出现 **「让 agent 安装」** 按钮。点击后 host 会确保一个**专属安装工作区**（`$DSH_HOME/marketplace-install`，经 `GET /api/market/install-workspace` 暴露），client 通过 runtime 的 `workspaces.create` / `sessions.create` / `sessions.open` 在该工作区**新开一个对话**并切过去，再把固定提示词 `session.prompt` 发给那个会话——由 agent 读 README 并自行决定安装方式，**不污染当前会话、无需手动选工作区**。若 runtime 服务不可用则回退为发给当前会话。代码在 `lib/client.js` 的 `installViaAgent`。更新/关闭/卸载仍走 host 接口（`/api/market/update` 等）。
- **更新插件（有新版本提示）** — 每个已安装插件都会对照最新版本（npm registry 的 `latest`，或 GitHub 默认分支 `package.json` 的 `version`，GitHub 插件优先）。有新版本时在卡片上标 **可更新** 并给 **更新** 按钮（`/api/market/update`）。
- **区分内置 / 后安装** — `dsh.profile.bundles` 里来自 profile 模板的包是**内置**插件（随 harness 提供，不能关闭 / 卸载），`dependencies` 里的是**后安装**插件。**已安装**标签页只展示后安装（第三方）插件，内置插件不列出（页面顶部有声明）。
- **后安装插件可停用 / 卸载** — **停用 / 启用**（`/api/market/set-enabled`）通过把它移出 / 移回 `dsh.profile.bundles` 实现（依赖保留）；**卸载**（`/api/market/uninstall`）通过 `dsh plugin --profile web remove <name>` 移除依赖并自动从 bundle 层摘除。两者都需重启 harness。
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
| Host 半 | `lib/index.js` | GitHub 分页同步 + `/api/market/list`、`/api/market/install`（异步任务）、`/api/market/install/status`、`/api/market/install/cancel`、`/api/market/installed`、`/api/market/update`、`/api/market/set-enabled`、`/api/market/uninstall` + `market_search`/`market_install`/`market_installed`/`market_update` 工具 |
| Client 半 | `lib/client.js` | `__ModuleLoader__` bundle：`插件市场` / `已安装` 两个设置标签页 + 搜索 + 加载更多 + 一键安装（带进度条/速度/大小/阶段/取消）+ 更新 / 停用 / 启用 / 卸载 + 市场自更新横幅 |

数据走 Host 半在 `ctx.webServer` 上注册的同源 HTTP 端点（`/api/market/*`）——永久插件没有 `harness`/`host.call` 沙箱 RPC，所以浏览器半用 `fetch`。

## 开发

```sh
npm run check   # 语法检查两个半
```

## License

MIT
