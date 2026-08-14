# dsh-plugin-marketplace

A permanent DeepSeek Harness plugin that turns the GitHub
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic (1800+ repos) into a
**plugin marketplace** — both a UI tab inside **设置 → 插件** and a pair of
model tools that let the agent itself search and install plugins.

## Features

- **Paginated feed** — the full topic is served page by page (default 50,
  max 100) from the GitHub Search API, with a "加载更多" button in the UI.
  No arbitrary 50-repo cap: `total` reflects the real `total_count`.
- **Search** — keyword search runs through GitHub's own `q` (so it searches
  the *whole* topic, not just loaded pages) and is available both in the UI
  search box and the `market_search` tool.
- **Agent tools** (registered on Host via `ctx.tools.register`):
  - `market_search(q?, page?, perPage?)` — JSON list of topic repos
    (full name, stars, language, description, URL).
  - `market_install(spec)` — install into the `web` profile via
    `dsh plugin --profile web add <spec>`. Validates the spec against shell
    metacharacters before running; reports that a harness restart is required.
- **Inside the Plugins settings** — registers `settings.plugins.tab` with id
  `market`, so the marketplace is a tab beside the shipped "插件配置" and
  "插件列表".

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
| Host half | `lib/index.js` | GitHub paginated sync + `/api/market/list` feed + `market_search`/`market_install` tools |
| Client half | `lib/client.js` | `__ModuleLoader__` bundle: Plugins-settings tab + search + load-more |

Data flows over the same-origin HTTP endpoint (`/api/market/list`) the Host
half registers on `ctx.webServer` — permanent bundles have no
`harness`/`host.call` sandbox RPC, so the browser half uses `fetch`.

## Development

```sh
npm run check   # syntax-check both halves
```

## License

MIT
