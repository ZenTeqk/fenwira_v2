# Fenwira Design System

## Scope

The visual contract for every Fenwira screen: tokens, semantic color rules, typography, spacing, shape, core components and how they are enforced.

## Decisions

This is a contract, not a suggestion. Tokens live in `packages/ui` and are the only source of color in the app. Feature code uses semantic Tailwind classes (`bg-primary`, `text-muted`, `border-border`) and never uses hex values.

## Color tokens

| Token | Hex | Use |
| --- | --- | --- |
| `--color-primary` | `#00A884` | Primary actions, active nav, focus rings, selected state |
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
9. Text on primary is white. Body text contrast is at least WCAG AA 4.5:1.

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
| Template variables `{{n}}` | `primary-soft` chip, `primary` text |
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

- A CI step fails if `apps/web` contains `#[0-9a-fA-F]{3,8}`, `rgb(` or `hsl(` outside `packages/ui`.
- ESLint forbids importing `@radix-ui/*` or `components/ui/*` in `apps/web`. Use `@fenwira/ui`.
- Adding a color means updating this doc first, then the tokens, in the same PR.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| DS1 | Dark mode in v2? Assumed no; the token structure must allow it later. | Product |
