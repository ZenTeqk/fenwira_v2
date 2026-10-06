# Experience V2 checkpoint evidence

Scope: EV2-01–04 only; stop for App Shell/Home/Inbox visual review. Later modules and Phase 11 closure are not declared complete.

## EV2-01 — Audit and foundation

Completed repository/route/component/API audit and visual inspection of all eleven references; recorded content-based Campaign/Studio filename correction. Reused the existing central UI theme, accessible primitives, typography and spacing. Refactored palette/control radius/focus into warm neutrals and distinct WhatsApp/success meanings; documented muted-text contrast deviation. No backend/schema/security changes.

Validation: UI unit suite **49 passed**, UI lint/typecheck passed, design-token check passed. Existing Radix Tabs test emits its pre-existing act warning; assertions pass. Contrast matrix includes selected/neutral/sidebar surfaces. Responsive and browser comparison are scheduled with the shell/Home/Inbox increments. See implementation plan for omitted unsupported screenshot features. Next: EV2-02 shell.

## EV2-02 — App Shell

Completed light 232px navigation, warm canvas, restrained active state, light mobile drawer, real member/role footer with shared account actions, wider contextual search and Home labels with stable `/dashboard` deep links. Reused session, workspace switch, command palette, notifications, help, permissions, wallet/connection hooks and shared primitives. No backend changes or rollout changes.

Validation: frontend lint/typecheck and **13 unit tests passed**; production web Docker build passed and local web restarted against existing mock services. Shell/navigation/keyboard/design/responsive/smoke browser run: **34 passed**, one renamed-link selector was ambiguous with the brand home link; corrected to exact Home navigation matching, focused rerun **1 passed**. Four widths (375/768/1024/1440) have no page overflow, icon rail persists at 64px, all visible navigation is reachable by command palette; shell/Home axe checks pass. No functionality was weakened to fix the selector. Final aggregate rerun follows Inbox.

Visual alignment: light sidebar/emerald selection/white topbar/warm surfaces follow all reference shells. Existing brand and icon rail remain intentionally preserved. Existing NOT_ENFORCED wallet visibility is preserved; no fictitious amount. Next: EV2-03 attention-first Home.
