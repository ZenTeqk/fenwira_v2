#!/usr/bin/env node
// Design-system enforcement (docs/DESIGN_SYSTEM.md → Enforcement). Fails when:
//   - apps/web or packages/ui components use a raw color (#hex, rgb(), hsl(), oklch())
//   - apps/web uses an arbitrary Tailwind value like `w-[13px]` or `text-[#00A884]`
//   - a class uses a retired color token (Tailwind would silently generate nothing for it)
// Raw colors are allowed only in packages/ui/src/tokens.ts (the source of truth), the generated
// packages/ui/src/styles/tokens.css and packages/ui/src/styles/theme.css.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SCAN = ['apps/web', 'packages/ui/src']
const ALLOW_COLORS = new Set([
  'packages/ui/src/tokens.ts',
  'packages/ui/src/styles/tokens.css',
  'packages/ui/src/styles/theme.css',
])
// Component palettes folded into semantic tokens (FENWIRA_DESIGN_SYSTEM.md → Color tokens).
const RETIRED =
  /\b(?:bg|text|border|ring|ring-offset|outline|fill|stroke|divide)-(?:inbox-[\w-]+|template-[\w-]+|thread-soft|message-outbound|note-soft|muted-decorative|avatar-(?:pink|lavender|peach|mint|blue)(?:-text)?)(?![\w-])/g
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'public',
])
const EXTENSIONS = /\.(tsx?|css|mdx?)$/
const COLOR = /(#[0-9a-fA-F]{3,8}\b(?![-\w]))|\b(rgba?|hsla?|oklch|oklab)\(/g
const ARBITRARY = /\b[a-z][\w:-]*-\[[^\]\s]+\]/g

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (EXTENSIONS.test(name)) yield full
  }
}

const problems = []
for (const base of SCAN) {
  for (const file of walk(join(ROOT, base))) {
    const rel = relative(ROOT, file)
    const isTest = /(^|\/)(test|e2e)\//.test(rel) || /\.test\.tsx?$/.test(rel)
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // comments may cite colors
        if (!ALLOW_COLORS.has(rel) && !isTest) {
          for (const m of line.matchAll(COLOR))
            problems.push(`${rel}:${i + 1}  raw color "${m[0]}" — use a design token`)
        }
        if (!isTest)
          for (const m of line.matchAll(RETIRED))
            problems.push(`${rel}:${i + 1}  retired color token "${m[0]}" — use a semantic token`)
        if (rel.startsWith('apps/web/') && !isTest) {
          for (const m of line.matchAll(ARBITRARY))
            problems.push(`${rel}:${i + 1}  arbitrary value "${m[0]}" — use the token scale`)
        }
      })
  }
}

if (problems.length > 0) {
  console.error(
    `Design token check failed (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.log('✔ design token check passed (no raw colors or arbitrary values)')
