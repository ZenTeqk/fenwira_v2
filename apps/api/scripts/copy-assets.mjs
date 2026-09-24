// tsc only emits .js; copy runtime data files next to their compiled modules.
import { cpSync } from 'node:fs'

cpSync('src/modules/identity/data', 'dist/modules/identity/data', { recursive: true })
