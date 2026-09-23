# Phase 2 — Design System & Application Shell

**Goal:** every later screen is assembled from `@fenwira/ui`. Developers never choose colors, spacing, badges or typography themselves.

**Read:** `AGENTS.md` (design system block), `docs/DESIGN_SYSTEM.md`, `docs/PRODUCT.md` (navigation).

## Build

1. **Tokens in `packages/ui`:** CSS variables for every token in `DESIGN_SYSTEM.md`, exposed as a Tailwind theme (`bg-primary`, `text-muted`, `border-border`, `bg-primary-soft` …). The token structure allows a dark theme later; don't ship dark mode now.
2. **Components:** all 29 components in `DESIGN_SYSTEM.md`, on shadcn/ui and Radix, one component per file, CVA variants, exported from `@fenwira/ui`.
   - `Button`: primary, secondary, ghost, danger, link. Sizes sm/md/lg. Loading state.
   - `StatusBadge`: a single map from domain status to `{tone, label, icon}` (connected, pending, failed, sent, delivered, read, draft, active, paused, takeover, …).
   - `DataTable`: TanStack Table with sort, row selection, cursor pagination, and loading/empty/error states.
   - `ConfirmDialog` + a `useConfirm()` hook. Every destructive action must use it.
   - `KpiCard`, `PageHeader` (title, description, breadcrumbs, actions), `EmptyState`, `ErrorState`, `Skeleton`.
3. **Gallery:** a `/dev/ui` route in `apps/web` (dev only) that renders every component and variant.
4. **App shell** (`apps/web/app/(app)/layout.tsx`):
   - Sidebar in `slate`, 248px, collapsible to 64px. A tenant-switcher slot at the top (static placeholder until Phase 3). The frozen nav with groups and sub-items. The active item has a `primary` indicator.
   - Top header: breadcrumb, command palette trigger (⌘K), notifications bell slot, user menu.
   - `background` page and `surface` cards.
   - Responsive: below 1024px the sidebar becomes a drawer. Nav items for unbuilt modules are hidden (feature-flag map in one file).
5. **Enforcement:** add the CI hex/rgb/hsl grep and an ESLint `no-restricted-imports` rule, per `DESIGN_SYSTEM.md`.
6. **Tests:** render tests for every component, axe accessibility checks on the gallery, and a keyboard test for Dropdown, Modal, Tabs and CommandPalette.

## Acceptance criteria

- [ ] `/dev/ui` shows every component and variant, with no axe violations at AA level.
- [ ] The shell renders at 1440, 1024 and 375 px widths without horizontal scroll.
- [ ] The CI grep finds zero hex, rgb or hsl colors in `apps/web`. Introducing one fails CI (show this in a throwaway commit).
- [ ] The command palette opens with ⌘K/Ctrl+K and navigates to every visible nav item.
- [ ] Every StatusBadge renders a text label, never color alone.
