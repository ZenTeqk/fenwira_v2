// Writes docs/openapi.json from the built API (decision API1). `--check` fails when it is stale.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const target = join(root, 'docs', 'openapi.json')
const { buildOpenApiDocument } = require('../dist/openapi/openapi.js')
const text = `${JSON.stringify(buildOpenApiDocument().document, null, 2)}\n`

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    // missing counts as stale
  }
  if (current !== text) {
    process.stderr.write(
      '✖ docs/openapi.json is stale. Run `pnpm openapi` and commit the result.\n',
    )
    process.exit(1)
  }
  process.stdout.write('✔ docs/openapi.json is up to date\n')
} else {
  writeFileSync(target, text)
  process.stdout.write(`wrote ${target}\n`)
}
