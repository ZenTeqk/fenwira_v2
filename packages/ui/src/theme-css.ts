import { componentTokens, palette, type PaletteRef, semanticTokens, tokenAliases } from './tokens'

/**
 * Renders styles/tokens.css from tokens.ts, the single source of color. tokens.test.ts compares
 * the committed file with this output, so the two can never drift.
 *
 * - Primitives become `--fw-<hue>-<step>` on :root. They are outside Tailwind's `--color-*`
 *   namespace, so no utility (`bg-neutral-600`) exists for them.
 * - Semantic, component and alias tokens become `--color-*` in `@theme static`, which generates the
 *   utilities and always emits every variable (aliases and dark overrides depend on them).
 * - `[data-theme='dark']` re-declares the same `--color-*` names with dark references; aliases are
 *   re-declared too, so a dark subtree resolves them against its own values.
 */
export function renderThemeCss(): string {
  const primitive = (ref: PaletteRef) => `var(--fw-${ref.replace('.', '-')})`
  const roles = { ...semanticTokens, ...componentTokens }

  const primitives: string[] = []
  for (const [group, value] of Object.entries(palette)) {
    // Lowercase hex: the generated file is also Prettier-formatted.
    if (typeof value === 'string') primitives.push(`  --fw-${group}: ${value.toLowerCase()};`)
    else
      for (const [step, hex] of Object.entries(value))
        primitives.push(`  --fw-${group}-${step}: ${hex.toLowerCase()};`)
  }

  const roleLines = (theme: 'light' | 'dark') =>
    Object.entries(roles).map(([name, refs]) => `  --color-${name}: ${primitive(refs[theme])};`)
  const aliasLines = Object.entries(tokenAliases).map(
    ([alias, target]) => `  --color-${alias}: var(--color-${target});`,
  )

  return [
    '/* GENERATED from packages/ui/src/tokens.ts by renderThemeCss(). Do not edit by hand:',
    '   change tokens.ts, then run `pnpm --filter @fenwira/ui test -u`. */',
    '',
    ':root {',
    ...primitives,
    '}',
    '',
    '@theme static {',
    '  --color-*: initial;',
    ...roleLines('light'),
    '  /* Deprecated Design System v1 aliases (tokens.ts → tokenAliases). */',
    ...aliasLines,
    '}',
    '',
    "[data-theme='dark'] {",
    '  color-scheme: dark;',
    ...roleLines('dark'),
    ...aliasLines,
    '}',
    '',
  ].join('\n')
}
