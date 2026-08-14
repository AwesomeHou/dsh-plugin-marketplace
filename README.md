# dsh-plugin-marketplace

A permanent DeepSeek Harness plugin that turns the GitHub
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic into a **plugin
marketplace** inside the Web UI.

- **Host half** (`lib/index.js`) syncs the GitHub Search API
  (`q=topic:dsh-plugin`, star-sorted, top 50) every 10 minutes, caches it in
  memory, and serves it as JSON over the web app's own HTTP server at
  `GET /api/market/list` (supports an optional `?q=` filter).
- **Client half** (`lib/client.js`) adds a **设置 → 插件市场** settings page
  that fetches that feed and renders a searchable list of plugins: name
  (opens the repo), description, star count, and language.

## Install

Install it as a permanent plugin into the `web` profile:

```sh
dsh plugin --profile web add <path-to-this-repo>
```

This forwards to pnpm, which installs the package into the profile; because
`package.json` declares `dsh.bundle.patch`, the plugin is automatically added
to the profile's `dsh.profile.bundles` layer stack.

> Requires a harness restart to take effect (bundle layers load at boot).

## How it is wired

| Piece | File | Role |
|---|---|---|
| Bundle manifest | `package.json` | Declares `dsh.bundle.patch` (host layer) and `dsh.client` (browser module) |
| Patch layer | `cordis.patch.yml` | Inserts the plugin's own host row into the Loader tree |
| Host half | `lib/index.js` | `fetch`es GitHub, caches, serves `/api/market/list` via `webServer` |
| Client half | `lib/client.js` | `__ModuleLoader__` bundle: settings page + search |

Unlike a dynamic Cordis plugin, a permanent bundle has **no** `harness` /
`host.call` sandbox RPC; the halves communicate over the same-origin HTTP
endpoint the Host half registers on `ctx.webServer`.

## Development

```sh
npm run check   # syntax-check both halves
```

## License

MIT
