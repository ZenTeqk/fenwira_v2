# ADR-0027: Managed Launch Mode

Status: accepted 2026-10-22 (founder brief "Managed Launch Mode", decisions ML-D1–ML-D8 in `PRODUCT.md` → Decision register).

## Context

Fenwira launches before Meta Tech Provider approval (MI1) and without a payment gateway (P11-D19). Embedded Signup can't onboard customers yet. Customers pay by UPI, and a platform operator checks each payment by hand. Each customer still gets an isolated workspace, its own team logins and the existing RBAC, with RLS unchanged.

## Decision

A platform switch, `MANAGED_LAUNCH_MODE` (env, default `false`), selects the launch model.

- **On:** platform operators connect each customer's WhatsApp Business Account from `/platform`. Tenant routes for Embedded Signup and every tenant-side change to the Meta connection return 404, and do so before body validation so the routes can't be probed:
  - `GET /config/whatsapp-signup`
  - `POST /whatsapp/connections`
  - `POST /whatsapp/connections/dev`
  - `POST /whatsapp/connections/:id/retry`
  - `POST /whatsapp/connections/:id/sync`
  - `POST /whatsapp/connections/:id/rotate-token`
  - `DELETE /whatsapp/connections/:id`
- **Still available to tenants:**
  - the read-only status: `GET /whatsapp/connections` shows status, quality rating, messaging limit and webhook state, with the token masked;
  - the label and default number (`PATCH`);
  - test sends.
- The UI shows "Contact support to connect WhatsApp" instead of Connect buttons. `GET /auth/me` returns `features.managedLaunch` to every member, so the shell, dashboard and Integrations pages adapt.
- **Off:** behaviour is unchanged. The Embedded Signup code stays in the repository and comes back by flipping the switch after Tech Provider approval.
- There is no card or gateway checkout anywhere in the product (P11-D19), so nothing more needs hiding. The UPI flow (ML-D3) is manual by design.

The rest of the launch model is built in separate steps, each with its own PR:

| Step | Scope |
| --- | --- |
| 2 | Operator-only manual Meta connection: per-WABA app secret (ML-D1), verify, subscribe, sync, rotation, audit |
| 3 | Manual UPI invoices, payment proofs, the operator payment queue, PAST_DUE/SUSPENDED (ML-D2, ML-D3, ML-D6) |
| 4 | Operator provisioning, copyable invite and reset links (ML-D4, ML-D7), SMTP made optional for the worker |
| 5 | `docs/MANAGED_LAUNCH.md` runbook and in-app operator checklist |
| 6 | First round trip against real Meta with one test number |
| 7 | Cross-tenant, secret-leak, rate-limit and CSRF hardening on every new route |

## Consequences

- The navigation stays frozen except for the additions the brief itself requires: Billing gains **Invoices** in step 3, and `/platform` gains connection, payment and provisioning screens.
- Switching production to `MANAGED_LAUNCH_MODE=true` is a rollout decision, made separately from merging. The deployment renderer keeps `false` until then.
- Webhook signature verification moves from one platform secret to the secret of the WABA the payload belongs to, falling back to the platform secret (ML-D1, step 2). No payload is persisted before a signature verifies.
