# dsh-plugin-marketplace

English | [中文](README.md)

A **permanent** DeepSeek Harness plugin that turns the GitHub
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic (1800+ repos) into a
**plugin marketplace** — a tab inside **设置 → 插件**, plus a pair of model
tools so the agent itself can search and install plugins.

## Features

- **Paginated feed** — the full topic is served page by page (default 50,
  max 100) from the GitHub Search API, with a "加载更多" (load more) button in
  the UI. No arbitrary 50-repo cap: `total` reflects the real `total_count`.
- **Search** — keyword search runs through GitHub's own `q`, so it searches
  the *whole* topic rather than only loaded pages. Available both in the UI
  search box and via the `market_search` tool.
- **Agent tools** (registered on Host via `ctx.tools.register`):
  - `market_search(q?, page?, perPage?)` — JSON list of topic repos
    (full name, stars, language, description, URL).
  - `market_install(spec)` — install into the `web` profile via
    `dsh plugin --profile web add -w <spec>`. Validates the spec against shell
    metacharacters before running; reports that a harness restart is required.
- **One-click install** — every marketplace card has an **安装** (Install)
  button that POSTs `/api/market/install` and shows
  installing/installed/failed state.
- **Inside the Plugins settings** — registers `settings.plugins.tab` with id
  `market`, so the marketplace sits beside the shipped "插件配置" (Plugin
  config) and "插件列表" (Plugin list) tabs.

## Install

```sh
dsh plugin --profile web add <path-to-this-repo>
```

Requires a harness restart to take effect.

## How it is wired

| Piece | File | Role |
|---|---|---|
| Bundle manifest | `package.json` | `dsh.bundle.patch` (host layer) + `dsh.client` (browser module) |
| Patch layer | `cordis.patch.yml` | Inserts the plugin's own host row into the Loader tree |
| Host half | `lib/index.js` | GitHub paginated sync + `/api/market/list` + `/api/market/install` + `market_search`/`market_install` tools |
| Client half | `lib/client.js` | `__ModuleLoader__` bundle: Plugins-settings tab + search + load-more + one-click install |

Data flows over the same-origin HTTP endpoint (`/api/market/list`) the Host
half registers on `ctx.webServer` — permanent bundles have no
`harness`/`host.call` sandbox RPC, so the browser half uses `fetch`.

## Development

```sh
npm run check   # syntax-check both halves
```

## License

MIT
