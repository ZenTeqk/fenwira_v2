# Fenwira Design System

## Scope

The visual contract for every Fenwira screen: tokens, semantic color rules, typography, spacing, shape, core components and how they are enforced.

## Decisions

This is a contract, not a suggestion. Tokens live in `packages/ui` and are the only source of color in the app. Feature code uses semantic Tailwind classes (`bg-primary`, `text-muted`, `border-border`) and never uses hex values.

## Color tokens

| Token | Hex | Use |
| --- | --- | --- |
| `--color-primary` | `#00A884` | Primary-action accents, active nav indicator, focus rings, selected state, checkbox/switch fills (non-text) |
| `--color-primary-hover` | `#008F70` | Hover/pressed for primary |
| `--color-primary-soft` | `#E7FCE8` | Selected rows, outbound bubbles, template variable chips |
| `--color-success` | `#25D366` | Live/connected/delivered, operational success |
| `--color-success-soft` | `#D1FAE5` | Success badge background |
| `--color-warning` | `#F59E0B` | Pending, warnings, conditions |
| `--color-danger` | `#EF4444` | Errors, failures, destructive actions |
| `--color-danger-soft` | `#FEE2E2` | Danger badge/alert background |
| `--color-info` | `#6366F1` | System info, human takeover, automation actions |
| `--color-slate` | `#0F172A` | Sidebar, headings, trigger nodes |
| `--color-slate-800` | `#1E293B` | Sidebar hover/secondary dark |
| `--color-slate-400` | `#94A3B8` | Idle edges, disabled icons, placeholders |
| `--color-muted` | `#64748B` | Secondary text, metadata |
| `--color-background` | `#F8FAFC` | App page background |
| `--color-surface` | `#FFFFFF` | Cards, panels, inbound bubbles |
| `--color-border` | `#E2E8F0` | All standard borders and dividers |
| `--color-neutral-soft` | `#F1F5F9` | System events, table header, neutral badges |
| `--color-primary-strong` | `#007F64` | **Filled** primary buttons (white text) and primary-colored **text** or links |
| `--color-primary-strong-hover` | `#006B54` | Hover/pressed for primary-strong |
| `--color-danger-strong` | `#C81E1E` | Filled destructive buttons (white text) and danger-colored text |
| `--color-danger-strong-hover` | `#A51919` | Hover/pressed for danger-strong |
| `--color-info-strong` | `#4F46E5` | Info/takeover-colored text; filled info buttons |

#### Why the `-strong` shades exist (decided 2026-09-23, Phase 2)

White text on `#00A884` measures 3.03:1, below the WCAG AA minimum of 4.5:1 for normal text. White on danger (3.76) and on info (4.47) also fall short, and so does `#00A884` as text on white (3.03). The product owner chose to keep every original color and add darker shades of the same hue, used **only** where text sits on a filled color or where colored text sits on a light surface. Each shade clears 4.5:1 on white, `background`, `neutral-soft` and its soft tint:

| Pair | Ratio |
| --- | --- |
| White on `primary-strong` | 4.98 |
| `primary-strong` on `primary-soft` | 4.62 |
| White on `danger-strong` | 5.74 |
| White on `info-strong` | 6.29 |

`#00A884` keeps its non-text roles: active-nav indicator, focus ring (3.03:1 against white satisfies the 3:1 rule for UI components), selected-row border, checkbox/switch fills and icons.

**Never use `warning` (`#F59E0B`, 2.15:1) or `success` (`#25D366`, 1.98:1) as a text color.** Use them only for icons, dots, borders and fills behind dark text.

**`muted` text is not allowed on `neutral-soft`** (4.46:1, found by the Phase 2 axe run). Table headers and other text on `neutral-soft` use `slate-800` (13.3:1) or `slate`.

Soft tints of warning and info, if needed, are derived in `packages/ui` with `color-mix()` and exposed as named tokens (`--color-warning-soft`, `--color-info-soft`). They are never inlined.

## Semantic rules

1. Primary `#00A884` is reserved for actions, active nav, focus and selection. Don't use it for decoration, illustrations or large fills.
2. Success `#25D366` means live or operational success.
3. Warning `#F59E0B` means warning or pending.
4. Danger `#EF4444` means error, failure or destructive action.
5. Info `#6366F1` means system, information or manual takeover.
6. Pages use `#F8FAFC`, cards use `#FFFFFF`, and borders use `#E2E8F0`.
7. Main navigation is `#0F172A`.
8. Status is never shown by color alone. Always pair it with a text label and/or an icon.
9. Filled buttons use the `-strong` shade with white text. Colored text uses `-strong` shades or `slate`. All text meets WCAG AA (4.5:1). Status badges use `slate` text on a soft tint, with the tone color on the icon.

## Module-specific color usage

| Context | Treatment |
| --- | --- |
| Sidebar | `slate` background, `slate-400` icons, active item uses a `primary` indicator and white text |
| Inbox: outbound (agent/bot) | `primary-soft` bubble |
| Inbox: inbound (customer) | `surface` bubble with a `border` |
| Inbox: selected conversation | `primary-soft` background plus a 3px `primary` left border |
| Inbox: system events | `neutral-soft` pill |
| Inbox: human takeover | `info` badge/banner |
| Inbox: internal note | `warning` soft tint with an "Internal" label |
| Template variables `{{n}}` | `primary-soft` chip, `primary-strong` text |
| Flow: trigger node | `slate` |
| Flow: message node | `surface` |
| Flow: condition node | `warning` |
| Flow: action node | `info` |
| Flow: selected node | `primary` ring |
| Flow: edges | idle `slate-400`, active `primary` |

## Typography, spacing, shape

- Font: Inter (UI) and JetBrains Mono (IDs, phone numbers, code). Load them through `next/font`.
- Type scale (px): 12 / 13 / 14 (body) / 16 / 18 / 20 / 24 / 30.
- Spacing is the Tailwind 4px scale only. No arbitrary `[13px]` values.
- Radius: 6 (controls), 8 (inputs, badges), 12 (cards, modals).
- Elevation: cards get a border and no shadow. Overlays (dropdown, modal, drawer, toast) get one shadow token.

## Core components (`packages/ui`)

Button, Input, Textarea, Select, Checkbox, Radio, Switch, Badge, StatusBadge, Avatar, Dropdown, Modal, Drawer, Tooltip, Tabs, Card, Table, DataTable, Pagination, Breadcrumb, CommandPalette, Toast, Alert, EmptyState, Skeleton, ErrorState, PageHeader, KpiCard, ConfirmDialog.

Each component:

- is built on shadcn/ui (Radix), with CVA variants bound to tokens
- has keyboard support and visible `primary` focus rings
- has a story or example on the `/dev/ui` gallery route (dev builds only)

`StatusBadge` maps domain status to token and label in a single place. Feature code passes the status and never picks a color itself.

## Enforcement

Implemented in Phase 2:

- **Tailwind theme reset.** `packages/ui/src/styles/theme.css` resets Tailwind's default palette, type scale, radii and shadows (`--color-*: initial` and so on). Only token utilities exist, so `bg-red-500` or `text-gray-600` generate nothing.
- **`pnpm lint:design`** (`scripts/check-design-tokens.mjs`, part of `pnpm lint` and CI) fails on:
  - raw colors (`#hex`, `rgb()`, `hsl()`, `oklch()`) anywhere in `apps/web` or `packages/ui/src`, except `tokens.ts` and `theme.css`
  - arbitrary Tailwind values (`w-[13px]`, `bg-[#…]`) in `apps/web`
- **ESLint** forbids `radix-ui`, `@radix-ui/*`, `cmdk`, `sonner`, `@tanstack/react-table`, `class-variance-authority` and `components/ui/*` imports in `apps/web`. Use `@fenwira/ui`.
- **Contrast tests.** `packages/ui/test/tokens.test.ts` asserts that every allowed text/fill pairing is at least 4.5:1, and that the forbidden `muted`-on-`neutral-soft` pairing stays documented.
- **axe e2e.** `apps/web/e2e/a11y.spec.ts` runs axe (WCAG 2.1 A/AA) on the gallery, the dashboard, open overlays and the mobile drawer.
- **Adding a color** means updating this doc first, then `tokens.ts` and `theme.css`, in the same PR.

### Where things live

| Thing | Location |
| --- | --- |
| Token values | `packages/ui/src/tokens.ts`, `packages/ui/src/styles/theme.css` |
| Components | `packages/ui/src/components/*` (exported from `@fenwira/ui`) |
| Status → tone/label/icon map | `STATUS_PRESETS` in `packages/ui/src/components/status-badge.tsx` |
| App shell | `apps/web/components/shell/*` |
| Navigation and phase visibility | `apps/web/lib/navigation.ts` (`SHIPPED_PHASE`) |
| Gallery | `/dev/ui` (when `ENABLE_UI_GALLERY=true`) |

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| DS1 | Dark mode in v2? Assumed no; the token structure must allow it later. | Product |
