/**
 * Build the client half: assemble src/locales.js (dictionaries) + src/app.js
 * (canonical dsh client with ctx.locale) into lib/client.js in the static
 * ModuleLoader bundle form.
 *
 * No build-tool dependencies: plain Node reads the ESM locales module and
 * concatenates the app body inside the `window.__ModuleLoader__.load({...})`
 * wrapper, injecting the dictionaries as the MARKET_LOCALES global.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const locales = (await import(join(root, 'src/locales.js'))).default
const app = await readFile(join(root, 'src/app.js'), 'utf8')

const head = `/**
 * dsh-plugin-marketplace — Client half (static bundle). Built from
 * src/locales.js + src/app.js via scripts/build-client.mjs — do not edit
 * lib/ directly.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-marketplace',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var MARKET_LOCALES = ${JSON.stringify(locales)}
`

const body = app

const tail = `
    return module.exports
  },
})
`

await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib/client.js'), head + body + tail, 'utf8')
console.log('built lib/client.js', (head + body + tail).length, 'bytes')