import { defineConfig, type UserConfig } from 'tsdown'

// Build for dsh-plugin-marketplace.
//
// The client half is a browser bundle loaded through the dsh module system:
// `window.__ModuleLoader__.load({ id, factory })`. Everything from the module
// table (react, cordis, dsh-client-*) stays external and resolves at runtime;
// the app code and the locale dictionaries (src/client/locales.js) are bundled
// in. `lib/client.js` is build output — never edit it in place.

const PACKAGE_ID = 'dsh-plugin-marketplace'

/** Platform modules provided by the dsh browser shell — stay external. */
const PLATFORM_EXTERNALS = [
  /^react($|\/)/,
  /^@deepseek-ai\/cordis($|\/)/,
  /^@deepseek-ai\/dsh-client-runtime($|\/)/,
  /^@deepseek-ai\/dsh-client-ui-slots($|\/)/,
  /^@deepseek-ai\/dsh-client-ui-primitives($|\/)/,
  /^@deepseek-ai\/dsh-client-connection($|\/)/,
  /^@deepseek-ai\/dsh-client-locale($|\/)/,
  /^@deepseek-ai\/dsh-client-ui-settings($|\/)/,
  /^@deepseek-ai\/dsh-client-ui-settings-plugins($|\/)/,
  /^@deepseek-ai\/dsh-api-remotes($|\/)/,
]

export default defineConfig([
  // ── Browser-half: client plugin bundle ───────────────────────────────
  {
    name: `${PACKAGE_ID}/client`,
    entry: { client: 'src/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    // The server half (lib/index.js) is a hand-maintained bundle kept in the
    // repo; never let the client build clean it out of the shared outDir.
    clean: false,
    deps: {
      neverBundle: (specifier: string) =>
        PLATFORM_EXTERNALS.some(pattern => pattern.test(specifier)),
      alwaysBundle: (specifier: string) =>
        !PLATFORM_EXTERNALS.some(pattern => pattern.test(specifier)),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  } satisfies UserConfig,
])