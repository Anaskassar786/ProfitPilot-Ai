# ProfitPilot — Billing Lifecycle & Feature Gating Enforcement Report

**Date:** 2026-08-25
**Scope:** Feature gating & entitlement lock/unlock, cancellation grace period, Shopify checkout redirect & verification safety, verification & tests.

---

## Task 1 — Feature Gating & Entitlement Lock/Unlock Enforcement

### Plan matrix (single source of truth in `@profitpilot/types` → `packages/billing/src/plans.ts`)

| Capability | START ($79) | GROWTH ($199) | COMMANDER ($399) |
|---|---|---|---|
| **Agents** | Revenue, Inventory, Customer | + Pricing | all 6 (Product + Executive unlocked) |
| Locked agents | Pricing, Product, Executive | Product, Executive | — |
| AI Commands / day | 100 | 300 | Unlimited (`null`) |
| Automation Workflows | 5 | 20 | Unlimited (`null`) |
| AI Recs / month | 150 | 300 | Unlimited (`null`) |
| Stores | 1 | 3 | Unlimited |
| Access | Basic analytics, reports, exports | Advanced analytics, forecasting, ROI attribution | Auto-execution, Exec weekly digest, VIP support |

The agent roster is enforced as a **named list** (`REVENUE_AGENT`, `INVENTORY_AGENT`, `CUSTOMER_AGENT`, `PRICING_AGENT`, `PRODUCT_AGENT`, `EXECUTIVE_AGENT`) so the Command Center renders exactly which agents each tier unlocks. Numeric caps all derive from `PLAN_ENTITLEMENT_LIMITS` — billing and plan-display code can never drift.

### Server-side enforcement (`packages/billing/src/entitlements.ts`)

- `limitForPlan(plan, feature)` — returns the canonical limit (`null` = unlimited, `0` = not included).
- `accessGate(subscription, context, now)` — central decision: checks plan state + usage meter; returns `{ allowed, readOnly, limit, remaining, reason }`. Read-only states drop to `ACCOUNT_READ_ONLY`; exceeded usage meters return `UPGRADE_REQUIRED`.
- `assertAccess(subscription, context, now)` — throws `UpgradeRequiredError` (402) when a feature is locked or a quota is exhausted.
- `agentAccess(plan, agent)` / `assertAgentAccess(plan, agent)` — named-agent unlock check with the **cheapest tier** that would unlock it.
- `UpgradeRequiredError` now returns **HTTP 402 PAYMENT_REQUIRED** for **every** lock (previously agent gates returned 403 FORBIDDEN). The error carries `{ feature, plan, reason: 'UPGRADE_REQUIRED', requiredPlan }` so the UI can pre-select the relevant plan and the API can tell a Start/Growth user exactly what to buy. This matches the spec: a Start/Growth user touching a Commander feature (Executive Agent, custom AI queries, auto-execution) gets 402 with the required plan level.

These are consumed by API routes — `ai-routes.ts` (`assertAgentAccess`, `agentAccess`), `automation-routes.ts` (`assertAccess` / `isReadOnly`), `analytics-routes.ts` (402 gating), `targeted-campaigns.ts` (`isReadOnly`), and the AI Command Center plan-aware service.

### Frontend gating UI

- Locked agent cards render through `LockedAgentCard` with an `onUpgrade(plan)` handler that opens the Billing page with the relevant plan (`command-center.tsx`).
- Locked personalities/templates show an `Upgrade Plan` state and route to upgrade (`settings.tsx`, `UpgradePlanButton`).
- 402 responses are surfaced as an upgrade prompt (`recommendations.tsx`, `settings.tsx`).
- On activation the UI dispatches `profitpilot:billing-updated` and reloads meters, so newly unlocked agents/limits appear **without a page refresh** (covered by the "upgrading the plan immediately unlocks agents" route test).

---

## Task 2 — Cancellation Grace Period Fix (honor paid days till period end)

**Problem:** Cancelling set status to `CANCELLED`, which immediately dropped access to `ACCOUNT_READ_ONLY`, contradicting the UI promise "You will retain access until the end of your current billing period."

**Fix** (`packages/billing/src/billing.ts`, `packages/billing/src/entitlements.ts`, `apps/api/src/billing-routes.ts`):

1. **New `effectiveBillingState(subscription, now)` / `billingStatusFor(...)`** distinguish two cancellation states:
   - `CANCELLED_ACTIVE` → status is `CANCELLED` **and** `now < currentPeriodEnd` → **full plan entitlements stay active** (grace window).
   - `CANCELLED_EXPIRED` → `now >= currentPeriodEnd` (or no period end recorded, fail-safe) → drop to `ACCOUNT_READ_ONLY`.
2. `isReadOnly` and `canUseEntitlement` are now **grace-aware**: a `CANCELLED` store is NOT read-only while inside its paid window, and flips to read-only only once the period ends.
3. `accessGate` / `assertAccess` honor the grace window (via `isReadOnlyState(subscription, now)`), so every entitlement read grants full access during grace.
4. `billing-routes.ts`:
   - `POST /billing/cancel` already **preserves `currentPeriodEnd`** (it spreads the existing record) and now returns the grace-aware `status` (`CANCELLED_ACTIVE` / `CANCELLED_EXPIRED`).
   - `GET /billing` also returns the derived `status` so the UI reacts without duplicating the period-end comparison.
5. Downstream hardcoded checks were updated to be grace-aware so cancellation never double-locks during grace: `automation-routes.ts` `assertWorkflowAccess` and `targeted-campaigns.ts` `requireGrowth` now call `isReadOnly(state, subscription)` instead of treating `CANCELLED` as always-read-only.

**Semantics:**
- `now < currentPeriodEnd`  → full entitlements (agents, commands, automations, recs).
- `now >= currentPeriodEnd` → `ACCOUNT_READ_ONLY` (billing/support/legal pages remain reachable).

---

## Task 3 — Shopify Checkout Redirect & Verification Safety

1. **Embedded redirect** — `redirectToShopifyCheckout` in `shopify-app-bridge.ts` escapes the embedded iframe via App Bridge navigation with `target: '_top'` (falling back to `window.open(url, '_top')`), which is required because Shopify checkout sends `X-Frame-Options: DENY`.
2. **Null `confirmationUrl`** — When Shopify GraphQL returns a null `confirmationUrl`, the UI must **not** fake a success toast. New pure helper `planChargeOutcome` (`App.tsx`) returns `redirect` / `mock-success` / `error`:
   - `confirmationUrl` present → redirect to checkout.
   - `confirmationUrl` null **and** `mock: true` (dev/test local activation only) → success with the real message.
   - `confirmationUrl` null otherwise → **error** toast: *"Unable to initiate Shopify checkout. Please try again or contact support."*
   `startCharge` uses this so a null URL never shows a misleading success.
3. **Test-mode auto-detection** — `billingTestMode` in `f5-bootstrap.ts` forces `test: true` whenever `NODE_ENV !== 'production'` **or** `SHOPIFY_BILLING_TEST=true` (also supports `SHOPIFY_BILLING_TEST_MODE` and `auto` shop-plan detection). Development/partner-test stores therefore never hit a billing 422 rejection.
4. **Return-URL auto-verification** — On return from Shopify checkout with `charge_id`/`chargeId`, `App.tsx` calls `POST /billing/charge/verify` (which verifies the charge and persists `ACTIVE_MONTHLY` / `ACTIVE_ANNUAL`), fires a celebratory toast, dispatches `profitpilot:billing-updated`, and cleans the search params via `window.history.replaceState`.

---

## Task 4 — Verification & Tests

### New tests added

| File | What it covers |
|---|---|
| `packages/billing/src/grace-period.test.ts` (9 tests) | `CANCELLED_ACTIVE` vs `CANCELLED_EXPIRED`, grace-aware `isReadOnly`/`canUseEntitlement`, `accessGate` grants full entitlements inside the paid window, drops to `ACCOUNT_READ_ONLY` after expiry, fail-safe on unknown period end, `assertAccess` (402) on quota exhaustion during grace, support/legal/billing reachable in both cases. |
| `packages/billing/src/feature-gating.test.ts` (12 tests) | Start vs Growth vs Commander agent roster (exact named lists), locked agents throw **402** with the cheapest `requiredPlan`, AI Commands / Automations / Recs limits, `active_agents` meter, exhausted-quota → `UPGRADE_REQUIRED`, Commander unlimited quotas never gate. |
| `apps/web/src/plan-charge-outcome.test.ts` (5 tests) | Null `confirmationUrl` handling in plan selection: real URL → redirect; null (non-mock) → **error** (no fake success); explicit `mock: true` → success; default mock message; guards the exact error copy. |

### Updated existing tests

- `packages/billing/src/pr45-plan-agents.test.ts` — locked-agent status assertion `403 → 402`.
- `apps/api/src/pr45-ai-routes.test.ts` — locked-agent run/pause assertions `403 → 402`.

### Full verification pipeline

| Command | Result |
|---|---|
| `pnpm build` | ✅ Clean monorepo build (20 workspace projects) |
| `pnpm typecheck` | ✅ 0 errors across the workspace |
| `pnpm test` | ✅ **250 test files passed, 3188 tests passed, 1 skipped** |

---

## Summary of files changed

- `packages/billing/src/billing.ts` — grace-aware `effectiveBillingState`/`billingStatusFor`/`isReadOnly`/`canUseEntitlement`.
- `packages/billing/src/entitlements.ts` — grace-aware `accessGate`/`assertAccess`, 402 for all `UpgradeRequiredError`s.
- `apps/api/src/billing-routes.ts` — exposes grace-aware `status` on GET /billing and POST /billing/cancel.
- `apps/api/src/automation-routes.ts`, `apps/api/src/targeted-campaigns.ts` — grace-aware read-only checks.
- `apps/api/src/f8-bootstrap.ts` — AI Command `billingStateFor` reports the active state during the cancellation grace window so Commander stays usable until the paid period ends.
- `apps/web/src/App.tsx` — null-`confirmationUrl` handling via `planChargeOutcome` (no fake success toast).
- Tests: `grace-period.test.ts`, `feature-gating.test.ts`, `plan-charge-outcome.test.ts` (new) + updated `pr45-plan-agents.test.ts`, `pr45-ai-routes.test.ts`.
